const { createDb } = require('../db/db');
const { createGeminiProvider } = require('../services/ai/aiProvider');
const { createTutorService } = require('../services/ai/tutorService');
const { createConversationStateStore } = require('../state/conversationStateStore');
const { createExplanationFlow } = require('../explanation/explanationFlow');
const { createQuizService } = require('../services/quizService');
const { createReminderService } = require('../reminders/reminderService');
const { createCommandRouter } = require('./commandRouter');
const { createSubscriptionService } = require('../services/subscriptionService');
const { getConfig } = require('../config/env');
const { createReadingCoachService } = require('../services/ai/readingCoachService');
const { logger } = require('../utils/logger');

/**
 * Builds and connects every new piece (database, AI provider, tutor
 * service, explanation flow, quiz service, reminder service, command
 * router) in one place.
 *
 * Call this ONCE from your existing entry file, passing in the things it
 * already has: your sheetsService instance, your command prefix, and your
 * whatsapp-web.js Client instance (needed so personal DM explanations and
 * daily reminders can actually be sent, not just group replies).
 *
 * @param {object} params
 * @param {object} params.sheetsService - your existing Google Sheets service instance
 * @param {string} params.prefix - your existing command prefix, e.g. '!'
 * @param {object} params.client - your whatsapp-web.js Client instance
 */
function createAiSetup({ sheetsService, prefix, client }) {
  const config = getConfig();
  const db = createDb(config.database.path);

  const aiProvider = createGeminiProvider({
    apiKey: config.geminiApiKey,
  });

  const subscriptionService = createSubscriptionService({ db });
  const tutorService = createTutorService({ aiProvider, db });
  const readingCoachService = createReadingCoachService({ aiProvider, db });
  const stateStore = createConversationStateStore();

  const explanationFlow = createExplanationFlow({
    tutorService,
    stateStore,
    logger,
    subscriptionService,
  });

  // Sends a direct message to a user's own chat (their WhatsApp ID, e.g.
  // "1234567890@c.us" — exactly what message.author/message.from already
  // gives you in a group, so no extra lookup needed).
  const sendDirectMessage = client
    ? async (userId, text) => {
        try {
          await client.sendMessage(userId, text);
        } catch (error) {
          logger.error(`Failed to send DM to ${userId}`, error);
        }
      }
    : null;

  // Daily reminder: nudges the group (and sends the admin a status copy)
  // starting at REMINDER_START_HOUR each day, up to 3 times 3 minutes
  // apart, stopping early once someone starts that day's quiz. See
  // quizService's onQuizStarted hook below for how it finds out.
  const reminderService = createReminderService({
    client,
    groupChatId: config.whatsapp.studyGroupChatId,
    adminNumber: config.whatsapp.adminNumber,
    startHour: config.quiz.reminderStartHour,
  });
  reminderService.start();

  const quizService = createQuizService({
    sheetsService,
    db,
    timeLimitSeconds: config.quiz.timeLimitSeconds,
    pointsPerCorrectAnswer: config.quiz.pointsPerCorrectAnswer,
    maxAttemptsPerQuestion: config.quiz.maxAttemptsPerQuestion,
    questionLimit: config.quiz.questionCount,
    explanationFlow,
    sendDirectMessage,
    subscriptionService,
    onQuizStarted: reminderService.markQuizStarted,
  });

  const router = createCommandRouter({
    prefix: prefix || config.commandPrefix,
    quizService,
    sheetsService,
    db,
    stateStore,
    explanationFlow,
    tutorService,
    subscriptionService,
    sendDirectMessage,
    client,
    readingCoachService,
    readingCoachPhoneNumber: config.whatsapp.readingCoachPhoneNumber,
  });

  return { db, quizService, router };
}

module.exports = { createAiSetup };
