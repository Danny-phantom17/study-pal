'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const IMPORT_PATH = '/internal/whatsapp-session';
const DEFAULT_MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5000;

function createWhatsAppAuthImporter({
  token = '',
  authDir,
  clientId = 'study-group-bot',
  logger = console,
  maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  inspectArchive = inspectTarArchive,
  extractArchive = extractTarArchive,
} = {}) {
  const secret = String(token || '').trim();
  const authRoot = path.resolve(authDir || './.wwebjs_auth');
  const sessionName = `session-${clientId}`;
  const sessionDir = path.join(authRoot, sessionName);
  let resolveImported;
  const importedPromise = new Promise((resolve) => { resolveImported = resolve; });
  let imported = false;

  function hasImportedSession() {
    const indexedDb = path.join(
      sessionDir,
      'Default',
      'IndexedDB',
      'https_web.whatsapp.com_0.indexeddb.leveldb',
    );
    try {
      return fs.statSync(indexedDb).isDirectory()
        && fs.readdirSync(indexedDb).some((entry) => entry !== 'LOCK');
    } catch {
      return false;
    }
  }

  async function handleRequest(request, response) {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      return false;
    }
    if (pathname !== IMPORT_PATH) return false;

    if (!secret) {
      request.resume();
      sendJson(response, 404, { error: 'Not found' });
      return true;
    }
    if (request.method !== 'POST') {
      request.resume();
      sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      return true;
    }
    if (!hasValidToken(request.headers.authorization, secret)) {
      request.resume();
      sendJson(response, 401, { error: 'Unauthorized' });
      return true;
    }
    if (hasImportedSession()) {
      request.resume();
      sendJson(response, 409, { error: 'A WhatsApp session already exists' });
      return true;
    }
    if (request.headers['content-type'] !== 'application/gzip') {
      request.resume();
      sendJson(response, 415, { error: 'Content-Type must be application/gzip' });
      return true;
    }

    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxArchiveBytes) {
      request.resume();
      sendJson(response, 413, { error: 'Archive exceeds the upload limit' });
      return true;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studypal-auth-import-'));
    const archivePath = path.join(tempDir, 'session.tar.gz');
    let receivedBytes = 0;
    try {
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          receivedBytes += chunk.length;
          if (receivedBytes > maxArchiveBytes) {
            callback(new Error('Archive exceeds the upload limit'));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(request, limiter, fs.createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
      if (!receivedBytes) throw new Error('The archive is empty');

      const archiveInfo = await inspectArchive(archivePath);
      validateArchiveEntries(archiveInfo, sessionName);
      if (archiveInfo.totalSize > MAX_EXPANDED_BYTES) {
        throw new Error('Archive expands beyond the allowed size');
      }

      fs.mkdirSync(authRoot, { recursive: true, mode: 0o700 });
      if (fs.existsSync(sessionDir)) throw new Error('A WhatsApp profile directory already exists');
      await extractArchive(archivePath, authRoot);
      if (!hasImportedSession()) throw new Error('The archive did not contain the WhatsApp IndexedDB profile');

      imported = true;
      resolveImported(true);
      logger.info(`Imported saved WhatsApp session (${receivedBytes} compressed bytes).`);
      sendJson(response, 201, { status: 'imported' });
    } catch (error) {
      logger.warn(`Saved WhatsApp session import failed: ${error.message}`);
      if (!response.headersSent) {
        const status = /upload limit/.test(error.message) ? 413 : 400;
        sendJson(response, status, { error: status === 413 ? 'Archive exceeds the upload limit' : 'Invalid WhatsApp session archive' });
      } else if (!response.writableEnded) {
        response.destroy();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return true;
  }

  async function waitForImport(timeoutMs = 15 * 60 * 1000) {
    if (imported) return true;
    if (!secret || hasImportedSession()) return false;
    let timeout;
    const timedOut = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
      timeout.unref?.();
    });
    const result = await Promise.race([importedPromise, timedOut]);
    clearTimeout(timeout);
    return result;
  }

  return {
    handleRequest,
    hasImportedSession,
    shouldWaitForImport: () => Boolean(secret) && !hasImportedSession(),
    waitForImport,
  };
}

function hasValidToken(header, expectedToken) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  if (!match) return false;
  const received = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function validateArchiveEntries(archiveInfo, requiredRoot) {
  if (!archiveInfo || !Array.isArray(archiveInfo.entries)
    || archiveInfo.entries.length === 0 || archiveInfo.entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('Archive has an invalid entry list');
  }

  const normalizedRoot = `${requiredRoot}/`;
  for (const entry of archiveInfo.entries) {
    const name = String(entry.name || '').replace(/\\/g, '/');
    const parts = name.split('/').filter(Boolean);
    if (!name || name.startsWith('/') || parts.some((part) => part === '..')
      || (name !== requiredRoot && !name.startsWith(normalizedRoot))) {
      throw new Error('Archive contains a path outside the WhatsApp session directory');
    }
    if (entry.type !== 'file' && entry.type !== 'directory') {
      throw new Error('Archive contains an unsupported entry type');
    }
    if (!Number.isFinite(entry.size) || entry.size < 0) {
      throw new Error('Archive contains an invalid file size');
    }
  }
}

async function inspectTarArchive(archivePath) {
  const [namesText, detailsText] = await Promise.all([
    runTar(['-tzf', archivePath]),
    runTar(['-tvzf', archivePath]),
  ]);
  const names = namesText.split(/\r?\n/).filter(Boolean);
  const details = detailsText.split(/\r?\n/).filter(Boolean);
  if (!names.length || names.length !== details.length) throw new Error('Archive listing is invalid');

  const entries = names.map((name, index) => {
    const detail = details[index];
    const typeIndicator = detail.trimStart()[0];
    const type = typeIndicator === 'd' ? 'directory' : typeIndicator === '-' ? 'file' : 'unsupported';
    const columns = detail.trim().split(/\s+/);
    const sizeColumn = columns[1]?.includes('/') ? 2 : 4;
    const size = type === 'directory' ? 0 : Number(columns[sizeColumn]);
    return { name, type, size };
  });
  return { entries, totalSize: entries.reduce((sum, entry) => sum + entry.size, 0) };
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Archive validation failed${stderr ? `: ${stderr.trim().slice(0, 120)}` : ''}`));
    });
  });
}

function extractTarArchive(archivePath, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', [
      '-xzf', archivePath,
      '-C', destination,
      '--no-same-owner',
      '--no-same-permissions',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Archive extraction failed${stderr ? `: ${stderr.trim().slice(0, 120)}` : ''}`));
    });
  });
}

function sendJson(response, status, body, extraHeaders = {}) {
  if (response.headersSent) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

module.exports = {
  createWhatsAppAuthImporter,
  validateArchiveEntries,
};
