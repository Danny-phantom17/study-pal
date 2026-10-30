'use strict';

const { logger } = require('../utils/logger');

const FOLLOW_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const SEND_HOUR_LAGOS = 10;
const SEND_WINDOW_START_HOUR_LAGOS = 9;
const SEND_WINDOW_END_HOUR_LAGOS = 19;
const SEND_DAILY_CAP = 10;
const MESSAGE_HISTORY_LIMIT = 30;
const INITIAL_REVIEW_DELAY_MS = 8000;

function createShedShareFollowUpService({ client, db, shedShareService }) {
  let interval = null;
  let running = false;
  let lastRunDate = null;

  async function runScheduledReview() {
    if (running || !client || !shedShareService) return false;
    running = true;
    let sentCount = 0;
    let reviewSucceeded = false;

    try {
      const chats = await getChatsWithRetry(client);
      reviewSucceeded = true;
      const ownChatId = client.info?.wid?._serialized;

      for (const chat of chats) {
        if (sentCount >= SEND_DAILY_CAP) break;

        const chatId = chat.id?._serialized;
        if (!chatId || chat.isGroup || chat.isChannel || chat.isReadOnly) continue;
        if (chatId === ownChatId || chatId === 'status@broadcast' || chatId.endsWith('@broadcast')) continue;
        if (db.hasShedShareFollowupClaim(chatId)) continue;

        const lastMessage = chat.lastMessage;
        if (!lastMessage?.fromMe || !lastMessage.timestamp) continue;
        if (Date.now() - lastMessage.timestamp * 1000 < FOLLOW_UP_AFTER_MS) continue;

        let claimed = false;
        const outreachMessageId = lastMessage.id?._serialized || `${chatId}:${lastMessage.timestamp}`;
        try {
          const messages = await chat.fetchMessages({ limit: MESSAGE_HISTORY_LIMIT });
          if (!messages.length) continue;
          if (!messages.some((message) => message.fromMe && looksLikeShedShareOutreach(message.body))) continue;

          claimed = db.claimShedShareFollowup(chatId, outreachMessageId);
          if (!claimed) continue;

          const mappedMessages = messages.map((message) => ({
            fromMe: message.fromMe,
            timestamp: message.timestamp,
            type: message.type,
            body: String(message.body || '').slice(0, 2000),
          }));
          const decision = await shedShareService.createScheduledFollowUp({ messages: mappedMessages });
          if (decision.retryable) {
            db.markShedShareFollowupFailed(chatId);
            continue;
          }
          if (!decision.eligible) {
            db.markShedShareFollowupClosed(chatId);
            continue;
          }

          const sentMessage = await client.sendMessage(chatId, decision.message);
          db.markShedShareFollowupSent(chatId, sentMessage?.id?._serialized || null);
          sentCount += 1;
          logger.info(`Sent one scheduled ShedShare follow-up (${sentCount}/${SEND_DAILY_CAP} today).`);
        } catch (error) {
          if (claimed) db.markShedShareFollowupFailed(chatId);
          logger.error('Could not process a scheduled ShedShare follow-up', error);
        }
      }
    } catch (error) {
      logger.error('ShedShare scheduled follow-up review failed', error);
    } finally {
      running = false;
    }

    logger.info(`ShedShare scheduled review finished; sent ${sentCount} follow-up(s).`);
    return reviewSucceeded;
  }

  async function runInitialReviewWithRetry(remainingRetries = 2) {
    const success = await runScheduledReview();
    if (success || remainingRetries <= 0) return;

    const delayMs = (3 - remainingRetries) * 30 * 1000;
    logger.warn(`WhatsApp could not complete the initial ShedShare review. Retrying in ${delayMs / 1000} seconds.`);
    const retryTimer = setTimeout(() => {
      runInitialReviewWithRetry(remainingRetries - 1)
        .catch((error) => logger.error('Initial ShedShare follow-up retry failed', error));
    }, delayMs);
    retryTimer.unref?.();
  }

  function checkSchedule() {
    const { date, hour } = getLagosTime();
    if (hour < SEND_HOUR_LAGOS || lastRunDate === date || running) return;

    lastRunDate = date;
    runScheduledReview().catch((error) => logger.error('ShedShare follow-up schedule failed', error));
  }

  function start() {
    if (interval) return;

    const now = getLagosTime();
    if (now.hour >= SEND_WINDOW_START_HOUR_LAGOS && now.hour < SEND_WINDOW_END_HOUR_LAGOS) {
      lastRunDate = now.date;
      logger.info('The first eligible ShedShare follow-up review will run after WhatsApp finishes loading.');
      const initialReviewTimer = setTimeout(() => {
        runInitialReviewWithRetry()
          .catch((error) => logger.error('Initial ShedShare follow-up review failed', error));
      }, INITIAL_REVIEW_DELAY_MS);
      initialReviewTimer.unref?.();
    } else if (now.hour >= SEND_HOUR_LAGOS) {
      lastRunDate = now.date;
    }

    interval = setInterval(checkSchedule, CHECK_INTERVAL_MS);
    interval.unref?.();
    logger.info('ShedShare follow-ups are scheduled daily at 10:00 Africa/Lagos: one message per eligible chat, no sooner than 3 days after outreach, with a maximum of 10 per day.');
  }

  function stop() {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
  }

  return { start, stop, runScheduledReview };
}

async function getChatsWithRetry(client) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.getChats();
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        try {
          const directChats = await getDirectChatsOnly(client);
          if (directChats.length) {
            logger.info(`Loaded ${directChats.length} direct WhatsApp chats for ShedShare review.`);
            return directChats;
          }
        } catch (fallbackError) {
          logger.warn('Could not load direct WhatsApp chats with the lightweight fallback.', fallbackError);
        }
      }
      if (attempt < 2) {
        logger.warn(`WhatsApp chat list is not ready yet; retrying (${attempt + 1}/2).`, error);
        await new Promise((resolve) => setTimeout(resolve, 2500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function getDirectChatsOnly(client) {
  if (!client.pupPage) return [];
  const chatIds = await client.pupPage.evaluate(() => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    return chats
      .filter((chat) => {
        const chatId = chat?.id?._serialized || '';
        return !chat.groupMetadata
          && !/@g\.us$|@broadcast$|@newsletter$/.test(chatId)
          && chatId !== 'status@broadcast';
      })
      .map((chat) => chat.id._serialized);
  });

  const directChats = [];
  for (const chatId of chatIds) {
    try {
      const chat = await client.getChatById(chatId);
      if (chat && !chat.isGroup && !chat.isChannel) directChats.push(chat);
    } catch (error) {
      logger.warn('WhatsApp could not hydrate direct chats for ShedShare history review; skipping this startup scan.', error);
      return [];
    }
  }
  return directChats;
}

function getLagosTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  };
}

function looksLikeShedShareOutreach(message) {
  return /shed\s?share|rent(?:al|er|ing)?|founding renter|list(?:ing)? an? item|marketplace/i.test(String(message || ''));
}

module.exports = { createShedShareFollowUpService, getLagosTime, looksLikeShedShareOutreach, getChatsWithRetry, getDirectChatsOnly };
