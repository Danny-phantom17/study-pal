const { logger } = require('../utils/logger');

const REMINDER_MESSAGES = [
  '*Study reminder* Keep your streak alive today. DM StudyPal with !quiz <subject> to practise privately.',
  '*Still time to study* A short private quiz is enough to make progress today. Try !quiz biology in DM.',
  '*Last reminder for today* Open your private chat with StudyPal and complete one quiz before the day ends.',
];

const INTERVAL_MS = 3 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

function createReminderService({ client, groupChatId, adminNumber, startHour = 14 }) {
  const lastQuizStartDate = new Map();
  let lastCycleDate = null;
  let activeCycleTimer = null;

  const adminChatId = adminNumber ? `${String(adminNumber).replace(/\D/g, '')}@c.us` : null;

  function markQuizStarted(chatId) {
    lastQuizStartDate.set(chatId, todayDateString());

    if (chatId === groupChatId && activeCycleTimer) {
      clearTimeout(activeCycleTimer);
      activeCycleTimer = null;
      logger.info(`Reminder cycle cancelled for ${chatId} because a quiz started`);
    }
  }

  function hasQuizStartedToday(chatId) {
    return lastQuizStartDate.get(chatId) === todayDateString();
  }

  async function sendToBoth(text) {
    if (!client || !groupChatId) return;

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
      logger.info('Reminder cycle stopped because a quiz already started today');
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

    if (lastCycleDate === today) return;
    if (new Date().getHours() !== startHour) return;

    lastCycleDate = today;
    logger.info(`Starting daily reminder cycle for ${groupChatId}`);
    runCycle(0);
  }

  function start() {
    if (!groupChatId) {
      logger.warn('Reminder service not started because STUDY_GROUP_CHAT_ID is not set.');
      return;
    }

    setInterval(checkAndMaybeStartCycle, CHECK_INTERVAL_MS);
    logger.info(`Reminder service watching for ${startHour}:00 local time daily.`);
  }

  return { start, markQuizStarted };
}

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = { createReminderService };
