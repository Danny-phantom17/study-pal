const test = require('node:test');
const assert = require('node:assert/strict');
const { getLagosTime, isFollowUpDue, shouldRunScheduledReview } = require('../services/shedShareFollowUpService');
const { createConservativeFollowUp } = require('../services/ai/shedShareService');

test('follow-up becomes due at the three-day mark only when the last message is outgoing', () => {
  const now = Date.parse('2026-10-31T09:00:00.000Z');
  const exactlyThreeDaysAgo = Math.floor((now - 3 * 24 * 60 * 60 * 1000) / 1000);
  assert.equal(isFollowUpDue({ fromMe: true, timestamp: exactlyThreeDaysAgo }, now), true);
  assert.equal(isFollowUpDue({ fromMe: true, timestamp: exactlyThreeDaysAgo + 1 }, now), false);
  assert.equal(isFollowUpDue({ fromMe: false, timestamp: exactlyThreeDaysAgo }, now), false);
});

test('daily follow-up review becomes eligible at 10:00 Africa/Lagos, once per date', () => {
  const beforeTen = new Date('2026-10-31T08:59:00.000Z');
  const tenLagos = new Date('2026-10-31T09:00:00.000Z');
  const local = getLagosTime(tenLagos);
  assert.deepEqual(local, { date: '2026-10-31', hour: 10 });
  assert.equal(shouldRunScheduledReview(beforeTen, '2026-10-30', false), false);
  assert.equal(shouldRunScheduledReview(tenLagos, '2026-10-30', false), true);
  assert.equal(shouldRunScheduledReview(tenLagos, '2026-10-31', false), false);
  assert.equal(shouldRunScheduledReview(tenLagos, '2026-10-30', true), false);
});

test('conservative fallback follows up only when the last owner message clearly asks for a response', () => {
  const eligible = createConservativeFollowUp([
    { fromMe: true, timestamp: 1, body: 'Would you be interested in this opportunity?' },
  ]);
  assert.equal(eligible.eligible, true);
  assert.match(eligible.message, /If you’re interested/);

  const noQuestion = createConservativeFollowUp([
    { fromMe: true, timestamp: 1, body: 'Thanks, have a good day.' },
  ]);
  assert.equal(noQuestion.eligible, false);

  const optedOut = createConservativeFollowUp([
    { fromMe: false, timestamp: 1, body: 'Not interested, please stop.' },
    { fromMe: true, timestamp: 2, body: 'Would you reconsider?' },
  ]);
  assert.equal(optedOut.eligible, false);

  const ownerExplainsOptOut = createConservativeFollowUp([
    { fromMe: true, timestamp: 1, body: 'Would you like to hear about this? If not interested, just let me know.' },
  ]);
  assert.equal(ownerExplainsOptOut.eligible, true);
});
