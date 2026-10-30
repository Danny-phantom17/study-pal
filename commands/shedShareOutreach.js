'use strict';

const { logger } = require('../utils/logger');

function createShedShareOutreachCommand({ leadType, db, client }) {
  return async function handleShedShareOutreachCommand({ message, args, userId, prefix }) {
    if (message.from.endsWith('@g.us')) {
      await message.reply('Use this outreach command in a private chat with StudyPal.');
      return;
    }

    if (!db.hasOwnerAccess(userId)) {
      await message.reply('Only the registered StudyPal owner number can start ShedShare outreach.');
      return;
    }

    const fields = args.join(' ').split('|').map((field) => field.trim());
    if (fields.length !== 3 || fields.some((field) => !field)) {
      await message.reply([
        `Usage: ${prefix}${leadType} <phone> | <name> | <location>`,
        `Example: ${prefix}lister 2348012345678 | Amina Yusuf | Ikeja, Lagos`,
      ].join('\n'));
      return;
    }

    const [phoneInput, nameInput, locationInput] = fields;
    const contactId = db.normalizeUserId(phoneInput);
    const phoneDigits = contactId.split('@')[0];
    if (!contactId.endsWith('@c.us') || !/^\d{10,15}$/.test(phoneDigits)) {
      await message.reply('Please enter a valid international WhatsApp number, such as 2348012345678.');
      return;
    }

    const ownNumber = client.info?.wid?._serialized;
    if (ownNumber && db.normalizeUserId(ownNumber) === contactId) {
      await message.reply('That is the StudyPal number. Enter the prospect’s WhatsApp number instead.');
      return;
    }

    const name = nameInput.replace(/[\r\n]+/g, ' ').slice(0, 100);
    const location = locationInput.replace(/[\r\n]+/g, ' ').slice(0, 120);
    const openingMessage = buildOpeningMessage({ leadType, name, location });

    try {
      await client.sendMessage(contactId, openingMessage);
    } catch (error) {
      logger.error(`Could not start ShedShare ${leadType} outreach`, error);
      await message.reply('I could not send that outreach message. Please check the number and try again.');
      return;
    }

    try {
      db.upsertShedShareLead({
        userId: contactId,
        leadType,
        name,
        location,
        source: 'manual-command',
      });
    } catch (error) {
      logger.error('The ShedShare outreach was sent, but its lead profile could not be saved.', error);
    }

    await message.reply(`ShedShare ${leadType} outreach sent to ${name} in ${location}. I’ll handle their replies and the scheduled follow-up.`);
  };
}

function buildOpeningMessage({ leadType, name, location }) {
  if (leadType === 'lister') {
    return `Hello ${name}, I’m reaching out from ShedShare, a marketplace where people list useful items for others nearby to rent. We’re preparing to launch and speaking with potential listers in ${location}. Would you be open to hearing more and possibly listing items you rent out?`;
  }

  return `Hello ${name}, I’m reaching out from ShedShare, a marketplace that helps people find useful items nearby to rent. We’re preparing to launch and speaking with potential renters in ${location}. Would you be open to hearing more about it before launch?`;
}

module.exports = { createShedShareOutreachCommand, buildOpeningMessage };
