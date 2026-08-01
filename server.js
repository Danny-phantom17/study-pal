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
    authStrategy: new LocalAuth({ clientId: 'study-group-bot' }),
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