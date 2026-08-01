const { logger } = require('../utils/logger');

const REMINDER_MESSAGES = [
  '📚 *Quiz time!* No one has started today\'s quiz yet. Reply with -quiz [subject] to get going!',
  '⏰ *Still waiting...* Today\'s quiz hasn\'t started yet. Don\'t break the streak — -quiz [subject] whenever you\'re ready!',
  '🚨 *Last reminder for today* — the quiz still hasn\'t started. y\'ll should get your sorry asses here and start quizzing! -quiz [subject]',
];

const INTERVAL_MS = 3 * 60 * 1000; // 3 minutes between each reminder
const CHECK_INTERVAL_MS = 60 * 1000; // how often to check whether it's time to start today's cycle

/**
 * Sends up to REMINDER_MESSAGES.length nudges to the study group (and, as a
 * status copy, to the admin's own number) starting at a configured hour each
 * day. Stops early — for that day — the moment someone starts a quiz in the
 * group chat. Call markQuizStarted(chatId) from wherever quizzes actually
 * get started (wired into quizService.js's onQuizStarted hook).
 *
 * @param {object} deps
 * @param {object} deps.client - whatsapp-web.js Client instance
 * @param {string} [deps.groupChatId] - the study group's WhatsApp chat id, e.g. "1203...@g.us"
 * @param {string} [deps.adminNumber] - admin's own number, digits only or with a leading "+", e.g. "+2347044438532"
 * @param {number} [deps.startHour] - 24-hour local time hour to begin the cycle, default 14 (2 PM)
 */
function createReminderService({ client, groupChatId, adminNumber, startHour = 14 }) {
  const lastQuizStartDate = new Map(); // chatId -> 'YYYY-MM-DD'
  let lastCycleDate = null; // 'YYYY-MM-DD' of the last day a cycle was started — so it only fires once/day
  let activeCycleTimer = null;

  const adminChatId = adminNumber ? `${String(adminNumber).replace(/\D/g, '')}@c.us` : null;

  function markQuizStarted(chatId) {
    lastQuizStartDate.set(chatId, todayDateString());

    if (chatId === groupChatId && activeCycleTimer) {
      clearTimeout(activeCycleTimer);
      activeCycleTimer = null;
      logger.info(`Reminder cycle cancelled for ${chatId} — quiz started`);
    }
  }

  function hasQuizStartedToday(chatId) {
    return lastQuizStartDate.get(chatId) === todayDateString();
  }

  async function sendToBoth(text) {
    if (!client) return;

    try {
      await client.sendMessage(groupChatId, text);
    } catch (error) {
      logger.error('Reminder: failed to send to group', error);
    }

    if (adminChatId) {
      try {
        await client.sendMessage(adminChatId, `[Group status]\n${text}`);
      } catch (error) {
        logger.error('Reminder: failed to send admin copy', error);
      }
    }
  }

  async function runCycle(messageIndex) {
    if (hasQuizStartedToday(groupChatId)) {
      logger.info('Reminder cycle stopped — quiz already started today');
      return;
    }

    if (messageIndex >= REMINDER_MESSAGES.length) return;

    await sendToBoth(REMINDER_MESSAGES[messageIndex]);

    if (messageIndex + 1 < REMINDER_MESSAGES.length) {
      activeCycleTimer = setTimeout(() => {
        runCycle(messageIndex + 1);
      }, INTERVAL_MS);
    }
  }

  function checkAndMaybeStartCycle() {
    const today = todayDateString();

    if (lastCycleDate === today) return; // already started (or skipped) today
    if (new Date().getHours() !== startHour) return;

    lastCycleDate = today;
    logger.info(`Starting daily reminder cycle for ${groupChatId}`);
    runCycle(0);
  }

  function start() {
    if (!groupChatId) {
      logger.warn('Reminder service not started — STUDY_GROUP_CHAT_ID is not set.');
      return;
    }

    setInterval(checkAndMaybeStartCycle, CHECK_INTERVAL_MS);
    logger.info(`Reminder service watching for ${startHour}:00 local time daily.`);
  }

  return { start, markQuizStarted };
}

function todayDateString() {
  // Local date, not UTC — matters here since getHours() above is also local,
  // and toISOString() would roll the date over at the wrong hour for WAT.
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = { createReminderService };