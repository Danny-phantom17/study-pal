'use strict';

function createBusinessProfileCommand({ db }) {
  return async function handleBusinessProfileCommand({ message, userId, args, prefix }) {
    if (message.from.endsWith('@g.us')) return message.reply('Use business profile commands in a private chat with StudyPal.');
    if (!db.hasOwnerAccess(userId)) return message.reply('Only the registered StudyPal owner can manage business profiles.');

    const action = String(args[0] || '').toLowerCase();
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

module.exports = { createBusinessProfileCommand, createBusinessOutreachCommand };
