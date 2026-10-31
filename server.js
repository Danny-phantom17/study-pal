require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('node:http');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { startQrBrowser } = require('./utils/qrBrowser');

const { createAiSetup } = require('./commands/aiSetup');
const { createGoogleSheetsService } = require('./services/googleSheetsService');
const { logger } = require('./utils/logger');

// Without this handler, an unhandled rejection thrown from inside a
// dependency (e.g. whatsapp-web.js's internal requestPairingCode call)
// crashes the process with Node's generic, hard-to-read default dump.
// This replaces that with one clear, greppable log line through the
// existing logger, then exits — preserving Render's current
// restart-on-crash behavior, just with a readable cause.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection (likely from inside whatsapp-web.js or Puppeteer, not application code):', reason);
  process.exit(1);
});

const commandPrefix = process.env.BOT_COMMAND_PREFIX || process.env.COMMAND_PREFIX || '!';
const webjsClientId = process.env.WEBJS_CLIENT_ID || 'study-group-bot';
const webjsAuthDir = process.env.WEBJS_AUTH_DIR || process.env.WWEBJS_AUTH_DIR || undefined;
const puppeteerExecutablePath = getPuppeteerExecutablePath();
const webjsSessionDir = getWebjsSessionDir(webjsAuthDir, webjsClientId);
const shouldClearChromiumLocks = process.env.WEBJS_CLEAR_CHROMIUM_LOCKS !== 'false';
const pairingPhoneNumber = normalizePairingPhoneNumber(
  process.env.WEBJS_PAIRING_PHONE_NUMBER || process.env.WHATSAPP_PAIRING_PHONE_NUMBER
);
const pairingCodeIntervalMs = normalizePositiveInteger(process.env.WEBJS_PAIRING_CODE_INTERVAL_MS, 180000);
const puppeteerHeadless = process.env.RENDER === 'true'
  || String(process.env.PUPPETEER_HEADLESS ?? 'false').toLowerCase() === 'true';

async function bootstrap() {
  logger.info('Starting WhatsApp Study Group Bot...');
  startRenderHealthEndpoint();
  const qrBrowser = startQrBrowser();
  logger.info(`WhatsApp auth directory: ${webjsAuthDir || 'default .wwebjs_auth'}`);
  logger.info(`Puppeteer executable: ${puppeteerExecutablePath || 'managed by Puppeteer'}`);
  logger.info(`Puppeteer headless mode: ${puppeteerHeadless}`);
  if (pairingPhoneNumber) {
    logger.info(`WhatsApp pairing code login enabled for phone number ending in ${pairingPhoneNumber.slice(-4)}.`);
  }
  if (shouldClearChromiumLocks) {
    clearChromiumProfileLocks(webjsSessionDir);
  }

  const sheetsService = createGoogleSheetsService();
  await sheetsService.initialize();

  const clientOptions = {
    authStrategy: new LocalAuth({
      clientId: webjsClientId,
      dataPath: webjsAuthDir,
    }),
    puppeteer: {
      headless: puppeteerHeadless,
      executablePath: puppeteerExecutablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--renderer-process-limit=1',
        // Everything below this line is new — these trim Chrome's baseline
        // RAM footprint on a memory-constrained host. None of them change
        // behavior; they just turn off subsystems whatsapp-web.js never
        // uses in headless mode (GPU compositing, extensions, background
        // network/sync services, etc.), so Chrome starts smaller and stays
        // smaller. Safe to keep permanently regardless of RAM tier.
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--disable-accelerated-2d-canvas',
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--no-first-run',
        '--no-zygote',
      ],
    },
  };

  if (pairingPhoneNumber) {
    clientOptions.pairWithPhoneNumber = {
      phoneNumber: pairingPhoneNumber,
      showNotification: true,
      intervalMs: pairingCodeIntervalMs,
    };
  }

  const client = new Client(clientOptions);
  const sendMessage = client.sendMessage.bind(client);
  client.sendMessage = (chatId, content, options = {}) => sendMessage(chatId, content, {
    ...options,
    sendSeen: options.sendSeen ?? false,
  });

  // createAiSetup wires up everything the AI explanation feature needs —
  // SQLite db, Gemini provider, tutor service, conversation state store,
  // explanation flow — and returns a quizService/router that already have
  // all of that connected. client is passed in so solo-chat DMs
  // (sendDirectMessage) actually work instead of being null.
  const { db, quizService, router, shedShareFollowUpService, businessFollowUpService } = createAiSetup({
    sheetsService,
    prefix: commandPrefix,
    client,
  });

  client.on('qr', (qr) => {
    qrBrowser.setQr(qr);
    logger.info('Scan this QR code with WhatsApp to authenticate:');
    qrcode.generate(qr, { small: false }, (qrText) => {
      logger.info(`\n${qrText}`);
    });
    logger.info('Open WhatsApp > Linked devices > Link a device, then scan the QR block above.');
    logger.info('If the QR is hard to scan in Render logs, set WEBJS_PAIRING_PHONE_NUMBER to your WhatsApp number in international format without +.');
  });

  client.on('code', (code) => {
    logger.info(`WhatsApp pairing code: ${code}`);
    logger.info('Open WhatsApp > Linked devices > Link with phone number instead, then enter this code.');
  });

  client.on('loading_screen', (percent, message) => {
    logger.info(`WhatsApp loading screen: ${percent}% ${message}`);
  });

  client.on('change_state', (state) => {
    logger.info(`WhatsApp connection state changed: ${state}`);
  });

  client.on('auth_failure', (message) => {
    qrBrowser.setStatus('auth_failure');
    logger.error(`WhatsApp authentication failed: ${message}`);
  });

  client.on('authenticated', () => {
    qrBrowser.setStatus('authenticating');
    logger.info('WhatsApp authentication successful.');
  });

  client.on('ready', () => {
    qrBrowser.setStatus('ready');
    logger.info('Study bot is ready and listening for messages.');
    shedShareFollowUpService.start();
    businessFollowUpService.start();
    shedShareFollowUpService.previewDirectChats()
      .then((summary) => logger.info(`WhatsApp history scan (review only; no messages sent): ${JSON.stringify(summary)}`))
      .catch((error) => logger.error('Could not scan direct WhatsApp histories for the follow-up review.', error));
  });

  client.on('group_join', async (notification) => {
    try {
      await notification.reply([
        '*Welcome to StudyPal Community*',
        `👋 Welcome, @user!

We're glad to have you in the StudyPal Community! 🎉

📚 This group is for educational discussions, asking academic questions, sharing study tips, and helping one another prepare for  JAMB and Post-UTME.

🤖 To access your personal StudyPal assistant, chat with @StudyPal in your private messages.

📖 Type:
help

to view all StudyPal features and commands.

🧠 Type:
whatsoever subject you want to study or interaction u want to have with the AI Tutor
to interact with the AI Tutor for explanations, learning assistance, and AI-powered quizzes.
e.g sending hi to the AI Tutor will initiate a conversation with the AI Tutor.

🆓 New User Trial:
• 20 questions per day for 7 days.
• 2 subjects per day.
• AI explanations enabled.

Free Plan After Trial:
• 5 questions per day.
• Access to all subjects.
• Limited AI tutor access.

👑 Want unlimited AI tutoring and quizzes?

Type:
subscribe

to view the Premium plan and upgrade.

After payment, type:
payment

and answer the text verification questions. No screenshot upload is required.

Please keep discussions respectful, educational, and free from spam.

Happy learning, and welcome once again to the StudyPal Community! 🚀📚`,
      ].join('\n'));
    } catch (error) {
      logger.error('Failed to send group welcome message', error);
    }
  });

  client.on('message_create', async (message) => {
    if (!message.fromMe) return;

    const ownChatId = client.info?.wid?._serialized;
    if (!ownChatId || db.normalizeUserId(message.to) !== db.normalizeUserId(ownChatId)) return;

    const text = String(message.body || '').trim();
    const isSecretaryCommand = /^(?:!|-)?\s*(?:lister|renter|account|accounts|business|outreach|sendlist)(?:\s|$)/i.test(text);
    if (!isSecretaryCommand && !router.shouldHandleSelfChatMessage(message)) return;

    logger.info('Owner secretary command or business setup reply received from the account self-chat.');
    try {
      await router.handleMessage(message);
    } catch (error) {
      logger.error('Could not process owner outreach command from the account self-chat.', error);
      await message.reply('Sorry, I could not process that outreach command. Please check the format and try again.');
    }
  });

  client.on('message', async (message) => {
    // WhatsApp Status updates can arrive through the same message event as
    // chats. They are not replyable conversations; attempting message.reply
    // on status@broadcast reaches whatsapp-web.js's unsupported status-send
    // path and can terminate the bot on current WhatsApp Web builds.
    if (message.from === 'status@broadcast' || message.to === 'status@broadcast') {
      return;
    }

    logger.info('Received a WhatsApp message event.');
    try {
      await router.handleMessage(message);
    } catch (error) {
      logger.error('Unhandled message processing error', error);
      await message.reply('Sorry, something went wrong while processing that. Please try again.');
    }
  });

  client.on('disconnected', (reason) => {
    qrBrowser.setStatus('disconnected');
    logger.warn(`WhatsApp client disconnected: ${reason}`);
  });

  async function shutdown(signal) {
    logger.info(`Shutting down bot after ${signal}...`);
    qrBrowser.close();
    shedShareFollowUpService.stop();
    businessFollowUpService.stop();
    await quizService.stopAll();
    if (db && typeof db.close === 'function') {
      db.close();
    }
    await client.destroy();
    process.exit(0);
  }

  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      logger.error('Failed during SIGINT shutdown', error);
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      logger.error('Failed during SIGTERM shutdown', error);
      process.exit(1);
    });
  });

  logger.info('Initializing WhatsApp client...');
  await client.initialize();
  logger.info('WhatsApp client initialization finished.');
}

function startRenderHealthEndpoint() {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const server = http.createServer((request, response) => {
    if (request.url !== '/' && request.url !== '/healthz') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ status: 'ok', service: 'StudyPal' }));
  });

  server.on('error', (error) => logger.error('Render health endpoint failed.', error));
  server.listen(port, '0.0.0.0', () => {
    logger.info(`Render health endpoint listening on port ${port}.`);
  });
  return server;
}

bootstrap().catch((error) => {
  logger.error('Failed to start bot', error);
  process.exit(1);
});

function getPuppeteerExecutablePath() {
  const configuredPath = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();

  if (!configuredPath) {
    return undefined;
  }

  if (fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  logger.warn(`Ignoring PUPPETEER_EXECUTABLE_PATH because it does not exist: ${configuredPath}`);
  return undefined;
}

function getWebjsSessionDir(authDir, clientId) {
  const baseAuthDir = path.resolve(authDir || './.wwebjs_auth');
  const sessionDirName = clientId ? `session-${clientId}` : 'session';
  return path.join(baseAuthDir, sessionDirName);
}

function clearChromiumProfileLocks(sessionDir) {
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  const removed = [];

  for (const lockFile of lockFiles) {
    const lockPath = path.join(sessionDir, lockFile);

    try {
      fs.rmSync(lockPath, { force: true });
      removed.push(lockFile);
    } catch (error) {
      logger.warn(`Could not remove Chromium profile lock ${lockFile}`, error);
    }
  }

  if (removed.length > 0) {
    logger.info(`Cleared Chromium profile lock path(s) from ${sessionDir}: ${removed.join(', ')}`);
  }
}

function normalizePairingPhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || '';
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
