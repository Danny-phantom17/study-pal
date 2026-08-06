const { handleHelpCommand } = require('./help');
const { handleQuizCommand } = require('./quiz');
const { handleLeaderboardCommand } = require('./leaderboard');
const { handleAttendanceCommand } = require('./attendance');
const { handleScoreCommand } = require('./score');
const { handleStopCommand } = require('./stop');
const { createHistoryCommand } = require('./history');
const { createStatsCommand } = require('./stats');
const { createGoalCommand } = require('./goal');
const { createStreakCommand } = require('./streak');
const { createBadgesCommand } = require('./badges');
const { createReviewCommand } = require('./review');
const { createReportCommand } = require('./report');
const {
  createPlanCommand,
  createUpgradeCommand,
  createAnalyticsCommand,
  createRecommendCommand,
  createAdminSubscriptionCommand,
  createAdminRoleCommand,
  formatUpgradePlans,
} = require('./subscription');
const { logger } = require('../utils/logger');

function createCommandRouter({ prefix, quizService, sheetsService, db, stateStore, explanationFlow, tutorService, subscriptionService }) {
  const pendingUpgradePrompts = new Map();
  const commands = new Map([
    ['help', handleHelpCommand],
    ['quiz', handleQuizCommand],
    ['leaderboard', handleLeaderboardCommand],
    ['attendance', handleAttendanceCommand],
    ['score', handleScoreCommand],
    ['stop', handleStopCommand],
    ['history', createHistoryCommand(db)],
    ['stats', createStatsCommand(db)],
    ['goal', createGoalCommand(db)],
    ['streak', createStreakCommand(db)],
    ['badges', createBadgesCommand(db)],
    ['achievements', createBadgesCommand(db)],
    ['review', createReviewCommand(db, subscriptionService)],
    ['report', createReportCommand(db)],
    ['plan', createPlanCommand(subscriptionService)],
    ['profile', createPlanCommand(subscriptionService)],
    ['upgrade', createUpgradeCommand()],
    ['subscribe', createUpgradeCommand()],
    ['analytics', createAnalyticsCommand(subscriptionService, db)],
    ['recommend', createRecommendCommand(subscriptionService, db)],
    ['adminplan', createAdminSubscriptionCommand(db)],
    ['adminrole', createAdminRoleCommand(db)],
  ]);

  async function handleMessage(message) {
    const text = (message.body || '').trim();
    const contact = await message.getContact();
    const username = contact.pushname || contact.name || contact.number || 'Unknown user';

    if (!text) return;

    const chatId = message.from;
    const userId = message.author || message.from;

    if (!chatId.endsWith('@g.us') && pendingUpgradePrompts.get(userId)) {
      const handled = await handleUpgradePromptReply({
        text,
        message,
        userId,
        prefix,
        pendingUpgradePrompts,
      });
      if (handled) return;
    }

    if (text.toUpperCase() === 'UPGRADE') {
      await message.reply(formatUpgradePlans());
      return;
    }

    if (text.startsWith(prefix)) {
      const [rawCommand, ...args] = text.slice(prefix.length).trim().split(/\s+/);
      const command = (rawCommand || '').toLowerCase();
      const handler = commands.get(command);

      if (!handler) {
        logger.info(`Invalid command "${command}" from ${username}`);
        await message.reply(`I do not recognize that command. Send ${prefix}help to see what I can do.`);
        return;
      }

      await handler({
        message,
        args,
        username,
        userId,
        prefix,
        quizService,
        sheetsService,
        db,
        stateStore,
        explanationFlow,
        pendingUpgradePrompts,
      });
      return;
    }

    // If this chat is currently in the shared post-answer Explanation phase
    // (only happens after a question's timer actually runs out — see
    // quizService.js / explanationFlow.js), route non-command messages
    // there instead of treating them as quiz answers. "next" advances the
    // quiz immediately; anything else is treated as a follow-up question
    // for the AI tutor.
    if (stateStore && explanationFlow && stateStore.getPhase(chatId) === 'explanation') {
      const handled = await explanationFlow.handleMessage({
        chatId,
        text,
        reply: message.reply.bind(message),
        userId,
      });
      if (handled) return;
    }

    const handledAsQuizAnswer = await quizService.handleAnswer({
      message,
      answerText: text,
      username,
      userId,
    });

    if (handledAsQuizAnswer) return;

    if (!chatId.endsWith('@g.us') && tutorService) {
      const reply = await tutorService.handleGeneralChat({
        userId: message.from,
        chatId: message.from,
        userMessage: text,
      });
      await message.reply(reply);
    }
  }

  return { handleMessage };
}

async function handleUpgradePromptReply({ text, message, userId, prefix, pendingUpgradePrompts }) {
  const normalized = String(text || '').trim().toLowerCase();

  if (['1', 'yes', 'y'].includes(normalized)) {
    pendingUpgradePrompts.delete(userId);
    await message.reply(formatUpgradePlans());
    return true;
  }

  if (['2', 'no', 'n'].includes(normalized)) {
    pendingUpgradePrompts.delete(userId);
    await message.reply([
      'No problem. Your free quiz sessions reset tomorrow.',
      '',
      'You can still:',
      '- Review previous quizzes',
      '- Read AI explanations',
      '- Check your study statistics',
      '- Participate in the StudyPal Community',
      '',
      `Send ${prefix}help to return to the main menu.`,
    ].join('\n'));
    return true;
  }

  return false;
}

module.exports = { createCommandRouter };
