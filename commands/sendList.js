'use strict';

const DAILY_BATCH_LIMIT = 100;
const SEND_PAUSE_MS = 900;

function createSendListCommand({ db, client }) {
  return async function handleSendListCommand({ message, userId, prefix }) {
    if (message.from.endsWith('@g.us')) return message.reply('Use this command in a private chat with StudyPal.');
    if (!db.hasOwnerAccess(userId)) return message.reply('Only the registered StudyPal owner can send a message list.');

    let raw = String(message.body || '').trim();
    const commandStarts = [`${prefix}sendlist`, '-sendlist', 'sendlist'];
    const commandStart = commandStarts.find((candidate) => raw.toLowerCase().startsWith(candidate.toLowerCase()));
    if (commandStart) raw = raw.slice(commandStart.length).trim();
    const separator = raw.indexOf('|');
    if (separator < 0) {
      return message.reply([
        `Usage: ${prefix}sendlist number1, number2, ... | your exact message`,
        `Example: ${prefix}sendlist 2348012345678, 07012345678 | Hello, just following up on my earlier message.`,
        `Maximum: ${DAILY_BATCH_LIMIT} unique numbers per command. Numbers do not need to be saved as contacts. Separate numbers with commas, semicolons, or new lines.`,
      ].join('\n'));
    }

    const rawNumbers = raw.slice(0, separator).trim();
    const text = raw.slice(separator + 1).trim();
    const entries = rawNumbers.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean);
    const normalizedEntries = entries.map((value) => db.normalizeUserId(value));
    const invalidCount = normalizedEntries.filter((value) => !/^\d{10,15}@c\.us$/.test(value)).length;
    if (invalidCount) return message.reply(`I found ${invalidCount} invalid number entr${invalidCount === 1 ? 'y' : 'ies'}. Separate valid phone numbers with commas, semicolons, or new lines; no one was messaged.`);
    const userIds = [...new Set(normalizedEntries)];
    const ownId = db.normalizeUserId(client.info?.wid?._serialized);
    const targets = userIds.filter((id) => id !== ownId);

    if (!text || text.length > 3000) return message.reply('Add the exact message after `|` (maximum 3,000 characters).');
    if (!targets.length) return message.reply('I could not find valid WhatsApp numbers. Use international digits or a Nigerian number starting with 0.');
    if (targets.length > DAILY_BATCH_LIMIT) return message.reply(`That is ${targets.length} numbers. Please send batches of at most ${DAILY_BATCH_LIMIT}.`);

    await message.reply(`Sending your exact message to ${targets.length} number(s)…`);
    let sent = 0;
    const failed = [];
    for (const target of targets) {
      try {
        await client.sendMessage(target, text);
        sent += 1;
      } catch {
        failed.push(target.split('@')[0]);
      }
      if (sent + failed.length < targets.length) await new Promise((resolve) => setTimeout(resolve, SEND_PAUSE_MS));
    }

    const result = [`Finished: ${sent} sent, ${failed.length} failed.`];
    if (failed.length) result.push(`Failed numbers: ${failed.join(', ')}`);
    await message.reply(result.join('\n'));
  };
}

module.exports = { createSendListCommand, DAILY_BATCH_LIMIT };
