require('dotenv').config();

const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const { createAiSetup } = require('./commands/aiSetup');
const { createGoogleSheetsService } = require('./services/googleSheetsService');
const { logger } = require('./utils/logger');

const commandPrefix = process.env.BOT_COMMAND_PREFIX || '!';

async function bootstrap() {
  logger.info('Starting WhatsApp Study Group Bot...');

  const sheetsService = createGoogleSheetsService();
  await sheetsService.initialize();

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'study-group-bot',
      dataPath: process.env.WWEBJS_AUTH_DIR || undefined,
    }),
    puppeteer: {
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

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
    qrcode.generate(qr, { small: true });
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

  process.on('SIGINT', async () => {
    logger.info('Shutting down bot...');
    await quizService.stopAll();
    if (db && typeof db.close === 'function') {
      db.close();
    }
    await client.destroy();
    process.exit(0);
  });

  await client.initialize();
}

bootstrap().catch((error) => {
  logger.error('Failed to start bot', error);
  process.exit(1);
});