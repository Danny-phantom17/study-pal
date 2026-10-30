const test = require('node:test');
const assert = require('node:assert/strict');
const { createShedShareFollowUpService } = require('../services/shedShareFollowUpService');

test('scheduled review can send one due follow-up to an unsaved direct number without live WhatsApp', async () => {
  const sent = [];
  let markedSent = false;
  const chatId = '2348012345678@c.us';
  const now = Math.floor(Date.now() / 1000);
  const chat = {
    id: { _serialized: chatId },
    lastMessage: { fromMe: true, timestamp: now - 4 * 24 * 60 * 60, id: { _serialized: 'outreach-1' } },
    fetchMessages: async () => [{ fromMe: true, timestamp: now - 4 * 24 * 60 * 60, body: 'Could we talk about this opportunity?' }],
  };
  const client = {
    info: { wid: { _serialized: '2347044438532@c.us' } },
    getChats: async () => [chat],
    sendMessage: async (target, text) => {
      sent.push({ target, text });
      return { id: { _serialized: 'followup-1' } };
    },
  };
  const db = {
    hasShedShareFollowupClaim: () => false,
    claimShedShareFollowup: () => true,
    markShedShareFollowupSent: () => { markedSent = true; },
    markShedShareFollowupFailed: () => assert.fail('a successful send must not be marked failed'),
    markShedShareFollowupClosed: () => assert.fail('an eligible chat must not be marked closed'),
  };
  const shedShareService = {
    createScheduledFollowUp: async () => ({ eligible: true, message: 'Just checking in about my earlier message.', retryable: false }),
  };
  const service = createShedShareFollowUpService({ client, db, shedShareService });

  const completed = await service.runScheduledReview();
  assert.equal(completed, true);
  assert.deepEqual(sent, [{ target: chatId, text: 'Just checking in about my earlier message.' }]);
  assert.equal(markedSent, true);
  service.stop();
});
