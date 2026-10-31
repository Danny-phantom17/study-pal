const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createWhatsAppAuthImporter } = require('../utils/whatsappAuthImporter');

async function withServer(importer, callback) {
  const server = http.createServer(async (request, response) => {
    const handled = await importer.handleRequest(request, response);
    if (!handled) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}/internal/whatsapp-session`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('WhatsApp session import requires the configured bearer token', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studypal-import-test-'));
  const importer = createWhatsAppAuthImporter({
    token: 'private-test-token',
    authDir: path.join(tempRoot, 'auth'),
    logger: { info() {}, warn() {} },
  });

  try {
    await withServer(importer, async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/gzip' },
        body: Buffer.from('not a real archive'),
      });
      assert.equal(response.status, 401);
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('authorized WhatsApp session import extracts the profile and releases startup wait', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studypal-import-test-'));
  const authDir = path.join(tempRoot, 'auth');
  const indexPath = path.join(
    'session-study-group-bot',
    'Default',
    'IndexedDB',
    'https_web.whatsapp.com_0.indexeddb.leveldb',
    '000001.ldb',
  ).replace(/\\/g, '/');
  const importer = createWhatsAppAuthImporter({
    token: 'private-test-token',
    authDir,
    logger: { info() {}, warn() {} },
    inspectArchive: async () => ({
      entries: [
        { name: 'session-study-group-bot/', type: 'directory', size: 0 },
        { name: indexPath, type: 'file', size: 4 },
      ],
      totalSize: 4,
    }),
    extractArchive: async (_archivePath, destination) => {
      const file = path.join(destination, ...indexPath.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'data');
    },
  });

  try {
    await withServer(importer, async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer private-test-token',
          'Content-Type': 'application/gzip',
        },
        body: Buffer.from('test archive'),
      });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { status: 'imported' });
      assert.equal(await importer.waitForImport(50), true);
      assert.equal(importer.hasImportedSession(), true);
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('WhatsApp session archive rejects paths outside its session folder', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studypal-import-test-'));
  const importer = createWhatsAppAuthImporter({
    token: 'private-test-token',
    authDir: path.join(tempRoot, 'auth'),
    logger: { info() {}, warn() {} },
    inspectArchive: async () => ({
      entries: [{ name: '../outside.txt', type: 'file', size: 4 }],
      totalSize: 4,
    }),
  });

  try {
    await withServer(importer, async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer private-test-token',
          'Content-Type': 'application/gzip',
        },
        body: Buffer.from('test archive'),
      });
      assert.equal(response.status, 400);
      assert.equal(importer.hasImportedSession(), false);
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
