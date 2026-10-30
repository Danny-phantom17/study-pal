const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessSecretary } = require('../services/ai/businessSecretary');

test('business secretary passes voice notes and images to the configured AI provider', async () => {
  const calls = [];
  const secretary = createBusinessSecretary({
    aiProvider: {
      generateCompletion: async (input) => {
        calls.push(input);
        return 'Thanks for sharing that. How can I help?';
      },
    },
  });
  const profile = {
    name: 'Acme Repairs',
    description: 'Repairs generators',
    offerings: 'Generator repairs and maintenance',
    targetCustomers: 'Homes in Lagos',
    interactionRules: 'Be polite and do not invent prices.',
  };
  const media = [
    { mimeType: 'audio/ogg', data: 'dm9pY2U=' },
    { mimeType: 'image/jpeg', data: 'aW1hZ2U=' },
  ];

  const reply = await secretary.replyToCustomer({
    profile,
    messages: [{ fromMe: false, body: '[media]' }],
    media,
  });

  assert.equal(reply, 'Thanks for sharing that. How can I help?');
  assert.deepEqual(calls[0].media, media);
  assert.match(calls[0].userPrompt, /voice note/i);
  assert.match(calls[0].userPrompt, /image/i);
  assert.match(calls[0].systemPrompt, /clearly visible/);
});
