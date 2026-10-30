const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessProfileCommand, handleBusinessProfileSetupReply, SETUP_STEPS } = require('../commands/businessProfile');

test('guided business setup asks all fields and saves the profile', async () => {
  const pendingSetups = new Map();
  let savedProfile = null;
  const db = {
    hasOwnerAccess: () => true,
    getBusinessProfile: () => null,
    upsertBusinessProfile: (profile) => { savedProfile = profile; },
  };
  const replies = [];
  const message = { from: '2347044438532@c.us', reply: async (text) => replies.push(text) };
  const command = createBusinessProfileCommand({ db, pendingSetups });

  await command({ message, userId: message.from, args: ['add'], prefix: '!' });
  const answers = ['acme', 'Acme Repairs', 'Repairs home generators', 'Repairs and maintenance', 'Homes in Lagos', 'Be polite; ask before booking', '3', '1'];
  for (const answer of answers) {
    const handled = await handleBusinessProfileSetupReply({
      message,
      userId: message.from,
      text: answer,
      db,
      pendingSetups,
    });
    assert.equal(handled, true);
  }

  assert.equal(SETUP_STEPS.length, 8);
  assert.deepEqual(savedProfile, {
    key: 'acme',
    name: 'Acme Repairs',
    description: 'Repairs home generators',
    offerings: 'Repairs and maintenance',
    targetCustomers: 'Homes in Lagos',
    interactionRules: 'Be polite; ask before booking',
    followupDays: 3,
    maxFollowups: 1,
  });
  assert.equal(pendingSetups.has(message.from), false);
  assert.match(replies.at(-1), /Saved Acme Repairs/);
});

test('guided business setup can be cancelled without saving', async () => {
  const pendingSetups = new Map([['owner@c.us', { step: 0, values: {} }]]);
  let saved = false;
  const message = { reply: async () => {} };
  const handled = await handleBusinessProfileSetupReply({
    message,
    userId: 'owner@c.us',
    text: 'cancel',
    db: { upsertBusinessProfile: () => { saved = true; } },
    pendingSetups,
  });
  assert.equal(handled, true);
  assert.equal(saved, false);
  assert.equal(pendingSetups.size, 0);
});
