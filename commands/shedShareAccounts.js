'use strict';

const { logger } = require('../utils/logger');
const { getChatsWithRetry } = require('../services/shedShareFollowUpService');

function createShedShareAccountsCommand({ db, client, shedShareService }) {
  return async function handleAccountsCommand({ message, userId }) {
    if (message.from.endsWith('@g.us')) {
      await message.reply('Use this command in a private chat with StudyPal.');
      return;
    }
    if (!db.hasOwnerAccess(userId)) {
      await message.reply('Only the registered StudyPal owner can view ShedShare accounts.');
      return;
    }

    await message.reply('I’m checking your ShedShare outreach chats now.');
    const leadsById = new Map(db.getShedShareLeads().map((lead) => [lead.userId, { ...lead, messages: [] }]));

    try {
      const chats = await getChatsWithRetry(client);
      const eligibleChats = chats.filter((chat) => {
        const chatId = chat.id?._serialized || '';
        return chatId && !chat.isGroup && !chat.isChannel && !chat.isReadOnly
          && chatId !== client.info?.wid?._serialized
          && chatId !== 'status@broadcast' && !chatId.endsWith('@broadcast');
      });

      for (const chat of eligibleChats) {
        const chatId = chat.id?._serialized;
        let messages;
        try {
          messages = await chat.fetchMessages({ limit: 12 });
        } catch (error) {
          logger.warn(`Could not read chat history for ShedShare account review: ${chatId}`, error);
          continue;
        }
        if (!messages.some((item) => item.fromMe && looksLikeShedShareOutreach(item.body))) continue;

        const id = db.normalizeUserId(chatId);
        const existing = leadsById.get(id);
        const outgoing = messages.filter((item) => item.fromMe).map((item) => String(item.body || '')).join('\n');
        const leadType = existing?.leadType || (
          /lister|rent out|list items|founding lister/i.test(outgoing) ? 'lister'
            : /potential renters|founding renter|rent from others/i.test(outgoing) ? 'renter'
              : 'unknown'
        );
        const contactName = chat.name || chat.pushname || chat.formattedTitle || id.split('@')[0];
        leadsById.set(id, {
          userId: id,
          leadType,
          name: existing?.name || contactName,
          location: existing?.location || 'Not recorded',
          messages: messages.map((item) => ({ fromMe: item.fromMe, body: String(item.body || '').slice(0, 900) })),
        });
      }
    } catch (error) {
      logger.error('Could not scan WhatsApp chats for ShedShare accounts', error);
    }

    const prospects = [...leadsById.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!prospects.length) {
      await message.reply('I don’t have any saved ShedShare outreach accounts yet. Use !lister or !renter to start an outreach and add someone to this list.');
      return;
    }

    const summaries = await shedShareService.summarizeProspectAccounts({ prospects });
    const lines = prospects.map((prospect, index) => {
      const summary = summaries[index] || { interest: 'Unknown', comment: 'Interest needs review.' };
      const phone = prospect.userId.split('@')[0];
      return `${index + 1}. ${prospect.name} — ${phone}\n   Type: ${capitalize(prospect.leadType)} | Interest: ${summary.interest}\n   Comment: ${summary.comment}\n   Location: ${prospect.location}`;
    });
    const heading = `ShedShare outreach accounts (${prospects.length})`;
    await replyInChunks(message, [heading, ...lines]);
  };
}

function looksLikeShedShareOutreach(value) {
  return /shed\s?share|founding renter|founding lister|rent(?:al|er|ing)?|list(?:ing)? an? item/i.test(String(value || ''));
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : 'Unknown';
}

async function replyInChunks(message, lines, limit = 3200) {
  let chunk = '';
  for (const line of lines) {
    const next = chunk ? `${chunk}\n\n${line}` : line;
    if (next.length > limit && chunk) {
      await message.reply(chunk);
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) await message.reply(chunk);
}

module.exports = { createShedShareAccountsCommand, looksLikeShedShareOutreach };
