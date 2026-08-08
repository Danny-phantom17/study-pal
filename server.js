require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const { createAiSetup } = require('./commands/aiSetup');
const { createGoogleSheetsService } = require('./services/googleSheetsService');
const { logger } = require('./utils/logger');

const commandPrefix = process.env.BOT_COMMAND_PREFIX || '!';
const webjsClientId = process.env.WEBJS_CLIENT_ID || 'study-group-bot';
const webjsAuthDir = process.env.WEBJS_AUTH_DIR || process.env.WWEBJS_AUTH_DIR || undefined;
const puppeteerExecutablePath = getPuppeteerExecutablePath();
const webjsSessionDir = getWebjsSessionDir(webjsAuthDir, webjsClientId);
const shouldClearChromiumLocks = process.env.WEBJS_CLEAR_CHROMIUM_LOCKS !== 'false';
const pairingPhoneNumber = normalizePairingPhoneNumber(
  process.env.WEBJS_PAIRING_PHONE_NUMBER || process.env.WHATSAPP_PAIRING_PHONE_NUMBER
);
const pairingCodeIntervalMs = normalizePositiveInteger(process.env.WEBJS_PAIRING_CODE_INTERVAL_MS, 180000);

async function bootstrap() {
  logger.info('Starting WhatsApp Study Group Bot...');
  logger.info(`WhatsApp auth directory: ${webjsAuthDir || 'default .wwebjs_auth'}`);
  logger.info(`Puppeteer executable: ${puppeteerExecutablePath || 'managed by Puppeteer'}`);
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
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      executablePath: puppeteerExecutablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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

  // createAiSetup wires up everything the AI explanation feature needs —
  // SQLite db, Gemini provider, tutor service, conversation state store,
  // explanation flow — and returns a quizService/router that already have
  // all of that connected. client is passed in so solo-chat DMs
  // (sendDirectMessage) actually work instead of being null.
  const { db, quizService, router } = createAiSetup({
    sheetsService,
    prefix: commandPrefix,
    client,
  });

  client.on('qr', (qr) => {
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
    logger.error(`WhatsApp authentication failed: ${message}`);
  });

  client.on('authenticated', () => {
    logger.info('WhatsApp authentication successful.');
  });

  client.on('ready', () => {
    logger.info('Study bot is ready and listening for messages.');
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

  client.on('message', async (message) => {
    try {
      await router.handleMessage(message);
    } catch (error) {
      logger.error('Unhandled message processing error', error);
      await message.reply('Sorry, something went wrong while processing that. Please try again.');
    }
  });

  client.on('disconnected', (reason) => {
    logger.warn(`WhatsApp client disconnected: ${reason}`);
  });

  async function shutdown(signal) {
    logger.info(`Shutting down bot after ${signal}...`);
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
      if (!fs.existsSync(lockPath)) {
        continue;
      }

      fs.rmSync(lockPath, { force: true });
      removed.push(lockFile);
    } catch (error) {
      logger.warn(`Could not remove Chromium profile lock ${lockFile}`, error);
    }
  }

  if (removed.length > 0) {
    logger.warn(`Removed stale Chromium profile lock file(s) from ${sessionDir}: ${removed.join(', ')}`);
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
