const { handleHelpCommand } = require('./help');
const { handleQuizCommand, startQuizForSubject, capitalizeSubject } = require('./quiz');
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
  // Per-user (DM only) state: while a user is choosing a quiz subject from
  // the numbered menu, this maps their userId -> the exact subject list
  // that menu was built from, so a later plain-number reply can be
  // resolved back to the right subject. Cleared as soon as a valid
  // selection is made, an invalid one triggers a re-prompt (map entry
  // stays), or the user sends "stop".
  const pendingSubjectSelections = new Map();
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
        pendingSubjectSelections,
      });
      return;
    }

    // If this user is currently choosing a quiz subject from the numbered
    // menu (see commands/quiz.js), a plain number reply belongs here, not
    // to the quiz-answer handler, the explanation flow, or the AI tutor.
    // Only ever active in DMs, and only while pendingSubjectSelections has
    // this userId — a bare "3" sent at any other time is NOT treated as a
    // subject selection or any other kind of command.
    if (!chatId.endsWith('@g.us') && pendingSubjectSelections.has(userId)) {
      const handled = await handleSubjectSelectionReply({
        text,
        message,
        userId,
        username,
        quizService,
        pendingSubjectSelections,
        pendingUpgradePrompts,
      });
      if (handled) return;
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
 * Diagnostic command — send "whoami" to see exactly what id WhatsApp is
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

/**
 * Handles a plain-number reply from a user who is currently choosing a
 * quiz subject from the menu (commands/quiz.js). Only ever called when
 * pendingSubjectSelections.has(userId) is already true, so a lone number
 * sent at any other time never reaches this function — it just falls
 * through to normal quiz-answer / AI-tutor handling as before.
 */
async function handleSubjectSelectionReply({ text, message, userId, username, quizService, pendingSubjectSelections, pendingUpgradePrompts }) {
  const subjects = pendingSubjectSelections.get(userId);
  if (!subjects) return false;

  const trimmed = String(text || '').trim();
  const choice = Number(trimmed);
  const isValidChoice = Number.isInteger(choice) && choice >= 1 && choice <= subjects.length;

  if (!isValidChoice) {
    await message.reply('\u274c Invalid choice.\n\nPlease reply with one of the numbers shown above.');
    return true;
  }

  const subject = subjects[choice - 1];
  pendingSubjectSelections.delete(userId);

  await message.reply(`\u2705 ${capitalizeSubject(subject)} selected.`);

  await startQuizForSubject({
    message,
    quizService,
    userId,
    username,
    subject,
    topic: '',
    pendingUpgradePrompts,
  });

  return true;
}

/**
 * Parses a raw message into { command, args, commandPrefix } or null.
 *
 * Two ways a message can be recognized as a command:
 *  1. Prefixed — starts with the configured prefix (e.g. "!") or the "-"
 *     alternate, exactly as before.
 *  2. Bare — no prefix at all, but the FIRST word of the (trimmed,
 *     case-insensitive) message exactly matches a known command name.
 *     Only the first word is checked, so ordinary sentences that merely
 *     mention a command word ("I need help with physics" — first word is
 *     "I", not "help") are never mistaken for a command. A message that
 *     genuinely starts with a command word as its first word ("help me
 *     with physics") will still be read as the help command, the same way
 *     it always would if prefixed — that tradeoff is inherent to removing
 *     the prefix requirement, not something a command parser can fully
 *     avoid, so keep the "!" prefix for a message that happens to start
 *     with a command word if you want to be unambiguous.
 */
function parseCommandText(text, prefix, commands) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;

  const candidates = [prefix];
  if (prefix !== '-') candidates.push('-');

  for (const candidate of candidates) {
    if (!candidate || !cleaned.startsWith(candidate)) continue;

    const [rawCommand, ...args] = cleaned.slice(candidate.length).trim().split(/\s+/);
    const command = (rawCommand || '').toLowerCase();

    if (candidate === '-' && !commands.has(command)) {
      continue;
    }

    return { command, args, commandPrefix: candidate };
  }

  // Bare command: no prefix present at all.
  const [rawCommand, ...args] = cleaned.split(/\s+/);
  const command = (rawCommand || '').toLowerCase();

  if (commands.has(command)) {
    return { command, args, commandPrefix: prefix };
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