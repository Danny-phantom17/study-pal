const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config/env');

test('loadConfig supplies safe development defaults', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.port, 3000);
  assert.equal(config.commandPrefix, '!');
  assert.equal(config.database.path, './data/studypal.db');
  assert.equal(config.quiz.reminderStartHour, 21);
  assert.equal(config.quiz.questionCount, 20);
  assert.equal(config.quiz.maxAttemptsPerQuestion, 2);
  assert.equal(config.payment.premiumPrice, 3000);
  assert.equal(config.geminiApiKey, '');
});

test('loadConfig converts numeric environment variables', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4100',
    PREMIUM_PRICE: '4500',
    QUIZ_TIME_LIMIT_SECONDS: '45',
    POINTS_PER_CORRECT_ANSWER: '2.5',
  });

  assert.equal(config.port, 4100);
  assert.equal(config.payment.premiumPrice, 4500);
  assert.equal(config.quiz.timeLimitSeconds, 45);
  assert.equal(config.quiz.pointsPerCorrectAnswer, 2.5);
});

test('loadConfig reports invalid numeric settings clearly', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', PORT: 'not-a-port' }),
    /Invalid environment configuration:[\s\S]*PORT/,
  );

  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', REMINDER_START_HOUR: '24' }),
    /Invalid environment configuration:[\s\S]*REMINDER_START_HOUR/,
  );
});

test('production requires a Gemini API key', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', GEMINI_API_KEY: '' }),
    /Invalid environment configuration:[\s\S]*GEMINI_API_KEY/,
  );

  const config = loadConfig({
    NODE_ENV: 'production',
    GEMINI_API_KEY: 'configured-api-key',
  });

  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.geminiApiKey, 'configured-api-key');
});
