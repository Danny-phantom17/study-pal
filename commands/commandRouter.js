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
const {
  createPaymentFlowState,
  createPaymentCommand,
  createPaymentFlowMessageHandler,
  createAdminDashboardCommand,
  createApprovePremiumCommand,
  createRejectPaymentCommand,
  createPaymentReceiptCommand,
} = require('./payment');
const { logger } = require('../utils/logger');

function createCommandRouter({ prefix, quizService, sheetsService, db, stateStore, explanationFlow, tutorService, subscriptionService, sendDirectMessage, client }) {
  const pendingUpgradePrompts = new Map();
  const paymentFlows = createPaymentFlowState();
  const handlePaymentFlowMessage = createPaymentFlowMessageHandler(db, paymentFlows);
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
    ['payment', createPaymentCommand(db, paymentFlows)],
    ['admindashboard', createAdminDashboardCommand(db)],
    ['dashboard', createAdminDashboardCommand(db)],
    ['payments', createAdminDashboardCommand(db)],
    ['approvepremium', createApprovePremiumCommand(db, sendDirectMessage)],
    ['rejectpayment', createRejectPaymentCommand(db, sendDirectMessage)],
    ['paymentreceipt', createPaymentReceiptCommand(db)],
    ['whoami', createWhoAmICommand(db, client)],
  ]);

  async function handleMessage(message) {
    const text = (message.body || '').trim();
    const contact = await message.getContact();
    const username = contact.pushname || contact.name || contact.number || 'Unknown user';

    if (!text) return;

    const chatId = message.from;
    const rawUserId = message.author || message.from;
    const userId = await resolveUserId(rawUserId, contact, db, client);
    db.upsertUser(userId, username);

    if (!chatId.endsWith('@g.us')) {
      const handledPaymentFlow = await handlePaymentFlowMessage({
        message,
        text,
        username,
        userId,
      });
      if (handledPaymentFlow) return;
    }

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

    const parsedCommand = parseCommandText(text, prefix, commands);
    if (parsedCommand) {
      const { command, args, commandPrefix } = parsedCommand;
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
        prefix: commandPrefix,
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
      if (subscriptionService) {
        const aiAccess = subscriptionService.tryConsumeAiMessage(userId);
        if (!aiAccess.allowed) {
          await message.reply(aiAccess.message);
          return;
        }
      }

      const reply = await tutorService.handleGeneralChat({
        userId,
        chatId: message.from,
        userMessage: text,
      });
      await message.reply(reply);
    }
  }

  return { handleMessage };
}

/**
 * WhatsApp's newer "LID" (Linked ID) privacy layer means message.author /
 * message.from sometimes arrives as "xxxxxxxxxxxxx@lid" instead of the
 * phone-number-based "xxxxxxxxxxxxx@c.us". A lid has no relationship to the
 * sender's actual phone number, so normalizing it directly produces a
 * user_id that never matches the phone-based rows seeded for the owner /
 * VIPs in db.js (OWNER_PHONE_ALIASES / VIP_PROFILES). That mismatch is what
 * makes the owner and VIPs get treated as ordinary free students.
 *
 * This resolves back to a real phone number before normalizing, using
 * whichever source is available.
 */
async function resolveUserId(rawUserId, contact, db, client) {
  if (!String(rawUserId || '').endsWith('@lid')) {
    return db.normalizeUserId(rawUserId);
  }

  const lidDigits = String(rawUserId).split('@')[0].replace(/\D/g, '');

  // Ask WhatsApp directly to map the lid back to a real phone number.
  // This is the only reliable source we've found — contact.number often
  // just echoes the lid's own digits back instead of the real phone.
  // Requires whatsapp-web.js >= 1.34.7 (getContactLidAndPhone).
  if (client?.getContactLidAndPhone) {
    try {
      const [resolved] = await client.getContactLidAndPhone([rawUserId]);
      if (resolved?.pn) {
        return db.normalizeUserId(resolved.pn);
      }
    } catch (error) {
      logger.warn(`Could not resolve lid ${rawUserId} to a phone number`, error);
    }
  }

  // Only trust contact.number if it's actually different from the lid's
  // own digits — otherwise it's not a real phone number, just an echo.
  if (contact?.number && contact.number.replace(/\D/g, '') !== lidDigits) {
    return db.normalizeUserId(contact.number);
  }

  // Fallback: at least consistent, even if it won't match owner/VIP records.
  return db.normalizeUserId(rawUserId);
}

/**
 * Diagnostic command — send "!whoami" to see exactly what id WhatsApp is
 * handing you and what it normalizes to, so you can confirm whether lid
 * resolution is kicking in correctly. Safe to remove once confirmed.
 */
function createWhoAmICommand(db, client) {
  return async function handleWhoAmICommand({ message, userId }) {
    const contact = await message.getContact();
    const status = db.getSubscriptionStatus(userId);
    const hasLidLookup = Boolean(client?.getContactLidAndPhone);

    await message.reply([
      `raw from: ${message.from}`,
      `raw author: ${message.author || '(none)'}`,
      `contact.number: ${contact.number || '(none)'}`,
      `getContactLidAndPhone available: ${hasLidLookup}`,
      `resolved userId: ${userId}`,
      `role: ${status.role}`,
      `plan: ${status.plan}`,
    ].join('\n'));
  };
}

function parseCommandText(text, prefix, commands) {
  const candidates = [prefix];
  if (prefix !== '-') candidates.push('-');

  for (const candidate of candidates) {
    if (!candidate || !text.startsWith(candidate)) continue;

    const [rawCommand, ...args] = text.slice(candidate.length).trim().split(/\s+/);
    const command = (rawCommand || '').toLowerCase();

    if (candidate === '-' && !commands.has(command)) {
      continue;
    }

    return { command, args, commandPrefix: candidate };
  }

  const bareCommand = String(text || '').trim().toLowerCase();
  if (['subscribe', 'payment', 'plan', 'help', 'dashboard'].includes(bareCommand) && commands.has(bareCommand)) {
    return { command: bareCommand, args: [], commandPrefix: prefix };
  }

  return null;
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
      'No problem. Your free question limit resets tomorrow.',
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