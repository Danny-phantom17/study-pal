const test = require('node:test');
const assert = require('node:assert/strict');
const { createSendListCommand } = require('../commands/sendList');

function normalizeUserId(value) {
  let digits = String(value).split('@')[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = `234${digits.slice(1)}`;
  return `${digits}@c.us`;
}

test('owner bulk-send normalizes an unsaved number and preserves the message text', async () => {
  const sent = [];
  const db = { hasOwnerAccess: () => true, normalizeUserId };
  const client = {
    info: { wid: { _serialized: '2347044438532@c.us' } },
    sendMessage: async (to, body) => sent.push({ to, body }),
  };
  const replies = [];
  const message = {
    from: '2347044438532@c.us',
    body: '!sendlist 07012345678 | Hello, checking in.\nHow can I help?',
    reply: async (body) => replies.push(body),
  };
  const command = createSendListCommand({ db, client });

  await command({ message, userId: message.from, prefix: '!' });
  assert.deepEqual(sent, [{ to: '2347012345678@c.us', body: 'Hello, checking in.\nHow can I help?' }]);
  assert.match(replies.at(-1), /1 sent, 0 failed/);
});

test('non-owner cannot use bulk-send', async () => {
  let sent = false;
  let reply = '';
  const command = createSendListCommand({
    db: { hasOwnerAccess: () => false, normalizeUserId },
    client: { sendMessage: async () => { sent = true; } },
  });
  await command({
    message: { from: '2348000000000@c.us', body: '!sendlist 07012345678 | Hello', reply: async (text) => { reply = text; } },
    userId: '2348000000000@c.us',
    prefix: '!',
  });
  assert.equal(sent, false);
  assert.match(reply, /Only the registered StudyPal owner/);
});
