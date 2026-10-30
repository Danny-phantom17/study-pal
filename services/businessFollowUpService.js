'use strict';

const { logger } = require('../utils/logger');

function createBusinessFollowUpService({ client, db, businessSecretary }) {
  let interval = null;
  let lastRunDate = null;
  let running = false;

  async function reviewDueLeads() {
    if (running || !client || !businessSecretary) return;
    running = true;
    try {
      const dueLeads = db.listDueBusinessFollowups();
      let sent = 0;
      for (const lead of dueLeads) {
        if (sent >= 10) break;
        try {
          const chat = await client.getChatById(lead.user_id);
          const lastMessage = chat.lastMessage;
          if (lastMessage && !lastMessage.fromMe) {
            db.markBusinessLeadReplied(lead.user_id);
            continue;
          }
          if (lastMessage?.timestamp && Date.now() - lastMessage.timestamp * 1000 < lead.followup_days * 24 * 60 * 60 * 1000) {
            continue;
          }

          const profile = db.getBusinessProfile(lead.businessKey);
          if (!profile) continue;
          const text = await businessSecretary.createFollowup({ profile, lead });
          await client.sendMessage(lead.user_id, text);
          const nextFollowupAt = lead.followups_sent + 1 < lead.max_followups
            ? new Date(Date.now() + lead.followup_days * 24 * 60 * 60 * 1000).toISOString()
            : null;
          db.markBusinessFollowupSent(lead.businessKey, lead.user_id, nextFollowupAt);
          sent += 1;
        } catch (error) {
          logger.warn(`Could not send scheduled ${lead.businessName} follow-up to ${lead.contact_name}.`, error);
        }
      }
      logger.info(`Business profile follow-up review finished; sent ${sent} follow-up(s).`);
    } finally {
      running = false;
    }
  }

  function checkSchedule() {
    const now = getLagosDateHour();
    if (now.hour < 10 || lastRunDate === now.date || running) return;
    lastRunDate = now.date;
    reviewDueLeads().catch((error) => logger.error('Business follow-up review failed.', error));
  }

  function start() {
    if (interval) return;
    const now = getLagosDateHour();
    if (now.hour >= 9 && now.hour < 19) {
      lastRunDate = now.date;
      const timer = setTimeout(() => reviewDueLeads().catch((error) => logger.error('Initial business follow-up review failed.', error)), 10000);
      timer.unref?.();
    } else if (now.hour >= 10) lastRunDate = now.date;
    interval = setInterval(checkSchedule, 60000);
    interval.unref?.();
  }

  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
  }

  return { start, stop, reviewDueLeads };
}

function getLagosDateHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

module.exports = { createBusinessFollowUpService };
