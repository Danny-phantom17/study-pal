'use strict';

const SETUP_STEPS = [
  { key: 'key', label: 'a short key', example: 'acme' },
  { key: 'name', label: 'the business name', example: 'Acme Repairs' },
  { key: 'description', label: 'what the business does', example: 'Repairs home generators' },
  { key: 'offerings', label: 'the products or services', example: 'Repairs and maintenance' },
  { key: 'targetCustomers', label: 'who the business serves', example: 'Homes and shops in Lagos' },
  { key: 'interactionRules', label: 'how the secretary should speak and what it should do or avoid', example: 'Be polite; ask before booking; never promise same-day service' },
  { key: 'followupDays', label: 'how many days to wait before a follow-up', example: '3' },
  { key: 'maxFollowups', label: 'the maximum number of follow-ups (0 turns them off)', example: '1' },
];

function createBusinessProfileCommand({ db, pendingSetups }) {
  return async function handleBusinessProfileCommand({ message, userId, args, prefix }) {
    if (message.from.endsWith('@g.us')) return message.reply('Use business profile commands in a private chat with StudyPal.');
    if (!db.hasOwnerAccess(userId)) return message.reply('Only the registered StudyPal owner can manage business profiles.');

    const action = String(args[0] || '').toLowerCase();
    if (action === 'add' && args.length === 1 || action === 'setup') {
      pendingSetups.set(userId, { step: 0, values: {} });
      return message.reply(`Let’s add your business step by step. Step 1 of ${SETUP_STEPS.length}: enter ${SETUP_STEPS[0].label} (letters/numbers, e.g. ${SETUP_STEPS[0].example}). Send cancel any time to stop.`);
    }

    if (action === 'preview') {
      return message.reply([
        'Business setup asks for these details, one at a time:',
        ...SETUP_STEPS.map((step, index) => `${index + 1}. ${step.label} (example: ${step.example})`),
        `Start: ${prefix}business add`,
      ].join('\n'));
    }

    if (action === 'list' || action === 'ls') {
      const profiles = db.listBusinessProfiles();
      if (!profiles.length) return message.reply('No business profiles yet. Add one with the format shown by !business help.');
      return message.reply(['Business profiles:', ...profiles.map((profile) =>
        `• ${profile.key} — ${profile.name} (follow up after ${profile.followupDays} day(s), max ${profile.maxFollowups})`)].join('\n'));
    }

    if (action === 'show') {
      const key = String(args[1] || '').toLowerCase();
      const profile = db.getBusinessProfile(key);
      if (!profile) return message.reply(`I could not find an active profile named “${key}”. Send ${prefix}business list.`);
      return message.reply([
        `${profile.name} (${profile.key})`,
        `What it does: ${profile.description}`,
        `Products/services: ${profile.offerings}`,
        `Target customers: ${profile.targetCustomers}`,
        `Interaction instructions: ${profile.interactionRules}`,
        `Follow-up: after ${profile.followupDays} day(s), at most ${profile.maxFollowups} time(s).`,
      ].join('\n'));
    }

    if (action === 'help' || action !== 'add') {
      return message.reply([
        `Add or update a profile:`,
        `${prefix}business add — start the guided setup, one question at a time`,
        `${prefix}business preview — show the setup steps`,
        `${prefix}business add | key | business name | what it does | products/services | target customers | interaction instructions | follow-up days | max follow-ups`,
        `Example: ${prefix}business add | acme | Acme Repairs | Repairs home generators | Repairs and maintenance | Homes in Lagos | Be polite; ask before booking; never promise same-day service | 3 | 1`,
        `View profiles: ${prefix}business list`,
        `View details: ${prefix}business show acme`,
        `Start outreach: ${prefix}outreach acme | 2348012345678 | Amina Yusuf | Ikeja, Lagos`,
        `Set max follow-ups to 0 to disable automatic follow-ups. Re-adding the same key updates that profile.`,
      ].join('\n'));
    }

    const fields = args.join(' ').split('|').map((field) => field.trim());
    if (fields.length !== 9 || fields[0].toLowerCase() !== 'add' || fields.slice(1, 7).some((field) => !field)) {
      return message.reply(`Profile details are incomplete. Send ${prefix}business help for the exact format.`);
    }

    const [, rawKey, name, description, offerings, targetCustomers, interactionRules, rawDays, rawMax] = fields;
    const key = rawKey.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    const followupDays = Number(rawDays);
    const maxFollowups = Number(rawMax);
    if (!key || !Number.isInteger(followupDays) || followupDays < 1 || followupDays > 365
      || !Number.isInteger(maxFollowups) || maxFollowups < 0 || maxFollowups > 20) {
      return message.reply('Use a simple key and whole numbers: follow-up days 1–365; max follow-ups 0–20.');
    }

    db.upsertBusinessProfile({
      key,
      name: name.slice(0, 100),
      description: description.slice(0, 1200),
      offerings: offerings.slice(0, 1200),
      targetCustomers: targetCustomers.slice(0, 500),
      interactionRules: interactionRules.slice(0, 1200),
      followupDays,
      maxFollowups,
    });
    await message.reply(`Saved the ${name} profile as “${key}”. Follow-ups: after ${followupDays} day(s), at most ${maxFollowups}. It is ready for owner-directed outreach with ${prefix}outreach.`);
  };
}

async function handleBusinessProfileSetupReply({ message, userId, text, db, pendingSetups }) {
  const setup = pendingSetups.get(userId);
  if (!setup) return false;
  const answer = String(text || '').trim();
  if (/^(?:cancel|stop)$/i.test(answer)) {
    pendingSetups.delete(userId);
    await message.reply('Business setup cancelled. Your existing profiles were not changed.');
    return true;
  }

  const step = SETUP_STEPS[setup.step];
  let value = answer;
  if (!value) {
    await message.reply(`Please enter ${step.label}. Example: ${step.example}`);
    return true;
  }

  if (step.key === 'key') {
    if (!/^[a-z0-9_-]{1,32}$/i.test(value)) {
      await message.reply('Use a short key with only letters, numbers, hyphens, or underscores. Example: acme');
      return true;
    }
    value = value.toLowerCase();
    if (db.getBusinessProfile(value)) {
      await message.reply(`The key “${value}” already exists. Choose another key, or use !business add | ... to update that profile.`);
      return true;
    }
  }

  if (step.key === 'followupDays' || step.key === 'maxFollowups') {
    const number = Number(value);
    const minimum = step.key === 'maxFollowups' ? 0 : 1;
    const maximum = step.key === 'maxFollowups' ? 20 : 365;
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      await message.reply(`Enter a whole number from ${minimum} to ${maximum}.`);
      return true;
    }
    value = number;
  } else {
    const maxLength = step.key === 'name' ? 100 : step.key === 'targetCustomers' ? 500 : 1200;
    value = value.slice(0, maxLength);
  }

  setup.values[step.key] = value;
  setup.step += 1;
  if (setup.step < SETUP_STEPS.length) {
    const next = SETUP_STEPS[setup.step];
    await message.reply(`Saved. Step ${setup.step + 1} of ${SETUP_STEPS.length}: enter ${next.label}. Example: ${next.example}`);
    return true;
  }

  db.upsertBusinessProfile(setup.values);
  pendingSetups.delete(userId);
  await message.reply(`Saved ${setup.values.name} as “${setup.values.key}”. Use !outreach ${setup.values.key} | phone | name | location to contact a customer, or !business show ${setup.values.key} to review the profile.`);
  return true;
}

function createBusinessOutreachCommand({ db, client, businessSecretary }) {
  return async function handleBusinessOutreachCommand({ message, userId, args, prefix }) {
    if (message.from.endsWith('@g.us')) return message.reply('Use outreach commands in a private chat with StudyPal.');
    if (!db.hasOwnerAccess(userId)) return message.reply('Only the registered StudyPal owner can start business outreach.');

    const fields = args.join(' ').split('|').map((field) => field.trim());
    if (fields.length !== 4 || fields.some((field) => !field)) {
      return message.reply(`Usage: ${prefix}outreach business-key | phone | name | location\nExample: ${prefix}outreach acme | 2348012345678 | Amina Yusuf | Ikeja, Lagos`);
    }
    const [key, phoneInput, name, location] = fields;
    const profile = db.getBusinessProfile(key.toLowerCase());
    if (!profile) return message.reply(`No active business profile named “${key}”. Send ${prefix}business list.`);

    const userIdForLead = db.normalizeUserId(phoneInput);
    const digits = userIdForLead.split('@')[0];
    if (!userIdForLead.endsWith('@c.us') || !/^\d{10,15}$/.test(digits)) {
      return message.reply('Enter the contact’s WhatsApp number in international format, such as 2348012345678.');
    }
    if (db.normalizeUserId(client.info?.wid?._serialized) === userIdForLead) {
      return message.reply('Enter the customer’s number, not the StudyPal business number.');
    }

    await message.reply(`Preparing an opening message for ${name} on behalf of ${profile.name}…`);
    let opening;
    try {
      opening = await businessSecretary.createOpeningMessage({ profile, name: name.slice(0, 100), location: location.slice(0, 120) });
      await client.sendMessage(userIdForLead, opening);
    } catch (error) {
      return message.reply(`I could not send the opening message for ${profile.name}. Please check the number and try again.`);
    }

    const followupAt = profile.maxFollowups > 0
      ? new Date(Date.now() + profile.followupDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
    db.recordBusinessOutreach({ businessKey: profile.key, userId: userIdForLead, contactName: name.slice(0, 100), location: location.slice(0, 120), outreachMessage: opening, followupAt });
    await message.reply(`Opening message sent for ${profile.name} to ${name}. I’ll handle their replies${profile.maxFollowups ? ` and send up to ${profile.maxFollowups} follow-up(s), ${profile.followupDays} day(s) apart if they don’t reply` : ''}.`);
  };
}

module.exports = { createBusinessProfileCommand, createBusinessOutreachCommand, handleBusinessProfileSetupReply, SETUP_STEPS };
