'use strict';

const { logger } = require('../utils/logger');

const FOLLOW_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const SEND_HOUR_LAGOS = 10;
const SEND_DAILY_CAP = 10;
const MESSAGE_HISTORY_LIMIT = 30;

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
        if (!isFollowUpDue(lastMessage)) continue;

        let claimed = false;
        const outreachMessageId = lastMessage.id?._serialized || `${chatId}:${lastMessage.timestamp}`;
        try {
          const messages = await chat.fetchMessages({ limit: MESSAGE_HISTORY_LIMIT });
          if (!messages.length) continue;
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
          logger.info(`Sent one scheduled WhatsApp follow-up (${sentCount}/${SEND_DAILY_CAP} today).`);
        } catch (error) {
          if (claimed) db.markShedShareFollowupFailed(chatId);
          logger.error('Could not process a scheduled WhatsApp follow-up', error);
        }
      }
    } catch (error) {
      logger.error('WhatsApp scheduled follow-up review failed', error);
    } finally {
      running = false;
    }

    logger.info(`WhatsApp scheduled review finished; sent ${sentCount} follow-up(s).`);
    return reviewSucceeded;
  }

  async function previewDirectChats() {
    const chats = await getChatsWithRetry(client);
    const ownChatId = client.info?.wid?._serialized;
    const directChats = chats.filter((chat) => {
      const id = chat.id?._serialized || '';
      return id && id !== ownChatId && !chat.isGroup && !chat.isChannel && !chat.isReadOnly
        && id !== 'status@broadcast' && !id.endsWith('@broadcast');
    });
    const latestThree = directChats
      .filter((chat) => chat.lastMessage?.timestamp)
      .sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp)
      .slice(0, 3)
      .map((chat) => ({
        contact: chat.name || (chat.id._serialized.endsWith('@lid') ? 'WhatsApp contact' : chat.id._serialized.split('@')[0]),
        lastMessageAt: new Date(chat.lastMessage.timestamp * 1000).toISOString(),
        lastMessageFromOwner: Boolean(chat.lastMessage.fromMe),
        lastMessage: String(chat.lastMessage.body || `[${chat.lastMessage.type || 'message'}]`).slice(0, 180),
      }));

    let eligibleFollowupsNow = 0;
    for (const chat of directChats) {
      const chatId = chat.id._serialized;
      if (!isFollowUpDue(chat.lastMessage) || db.hasShedShareFollowupClaim(chatId)) continue;
      const messages = await chat.fetchMessages({ limit: MESSAGE_HISTORY_LIMIT });
      const decision = await shedShareService.createScheduledFollowUp({
        messages: messages.map((message) => ({
          fromMe: message.fromMe,
          timestamp: message.timestamp,
          type: message.type,
          body: String(message.body || '').slice(0, 2000),
        })),
      });
      if (decision.eligible) eligibleFollowupsNow += 1;
    }
    return { scannedDirectChats: directChats.length, latestThree, eligibleFollowupsNow };
  }

  function checkSchedule() {
    const { date } = getLagosTime();
    if (!shouldRunScheduledReview(new Date(), lastRunDate, running)) return;

    lastRunDate = date;
    runScheduledReview().catch((error) => logger.error('WhatsApp follow-up schedule failed', error));
  }

  function start() {
    if (interval) return;

    const now = getLagosTime();
    if (now.hour >= SEND_HOUR_LAGOS) lastRunDate = now.date;

    interval = setInterval(checkSchedule, CHECK_INTERVAL_MS);
    interval.unref?.();
    logger.info('One-time WhatsApp follow-ups are scheduled daily at 10:00 Africa/Lagos: only direct chats with a clear unanswered request, at least 3 days since the last outgoing message, at most one message per chat, maximum 10 per day.');
  }

  function stop() {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
  }

  return { start, stop, runScheduledReview, previewDirectChats };
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
            logger.info(`Loaded ${directChats.length} direct WhatsApp chats for follow-up review.`);
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
  const rawChats = await client.pupPage.evaluate(async () => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    const selected = chats.filter((chat) => {
        const chatId = chat?.id?._serialized || '';
        return !chat.groupMetadata
          && /@(?:c\.us|lid)$/.test(chatId)
          && !/@g\.us$|@broadcast$|@newsletter$/.test(chatId)
          && chatId !== 'status@broadcast';
      });

    const results = [];
    for (const chat of selected) {
      try {
        let messages = chat.msgs?.getModelsArray?.() || [];
        while (messages.length < MESSAGE_HISTORY_LIMIT) {
          let earlier;
          try {
            earlier = await window.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat });
          } catch (_) {
            break;
          }
          if (!earlier?.length) break;
          messages = chat.msgs?.getModelsArray?.() || [...earlier, ...messages];
        }
        messages = messages.slice(-MESSAGE_HISTORY_LIMIT);
        results.push({
          id: chat.id._serialized,
          name: chat.name || chat.formattedTitle || chat.contact?.name || '',
          isGroup: false,
          isChannel: false,
          isReadOnly: false,
          messages: messages.filter((message) => !message.isNotification
            && !['notification_template', 'protocol', 'ciphertext', 'e2e_notification'].includes(message.type)).map((message) => ({
            id: { _serialized: message.id?._serialized || '', fromMe: Boolean(message.id?.fromMe) },
            fromMe: Boolean(message.id?.fromMe),
            timestamp: Number(message.t || 0),
            type: message.type || 'chat',
            body: String(message.body || message.caption || message.pollName || '').slice(0, 2000),
          })),
        });
      } catch (_) {
        // A malformed or transitioning chat should not prevent scanning its siblings.
      }
    }
    return results;
  });

  const chats = rawChats.map((raw) => {
    const messages = raw.messages;
    const lastMessage = messages.at(-1) || null;
    return {
      id: { _serialized: raw.id },
      name: raw.name,
      isGroup: false,
      isChannel: false,
      isReadOnly: false,
      lastMessage,
      fetchMessages: async ({ limit } = {}) => limit > 0 ? messages.slice(-limit) : messages,
    };
  });
  logger.info(`Read ${chats.length} direct WhatsApp chat histories from the WhatsApp page models (including unsaved numbers).`);
  return chats;
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

function isFollowUpDue(lastMessage, now = Date.now()) {
  return Boolean(lastMessage?.fromMe && lastMessage.timestamp
    && now - lastMessage.timestamp * 1000 >= FOLLOW_UP_AFTER_MS);
}

function shouldRunScheduledReview(now = new Date(), lastRunDate = null, running = false) {
  const local = getLagosTime(now);
  return local.hour >= SEND_HOUR_LAGOS && lastRunDate !== local.date && !running;
}

module.exports = { createShedShareFollowUpService, getLagosTime, getChatsWithRetry, getDirectChatsOnly, isFollowUpDue, shouldRunScheduledReview };
