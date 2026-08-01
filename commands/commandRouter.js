const { handleHelpCommand } = require('./help');
const { handleQuizCommand } = require('./quiz');
const { handleLeaderboardCommand } = require('./leaderboard');
const { handleAttendanceCommand } = require('./attendance');
const { handleScoreCommand } = require('./score');
const { handleStopCommand } = require('./stop');
const { logger } = require('../utils/logger');

function createCommandRouter({ prefix, quizService, sheetsService, stateStore, explanationFlow }) {
  const commands = new Map([
    ['help', handleHelpCommand],
    ['quiz', handleQuizCommand],
    ['leaderboard', handleLeaderboardCommand],
    ['attendance', handleAttendanceCommand],
    ['score', handleScoreCommand],
    ['stop', handleStopCommand],
  ]);

  async function handleMessage(message) {
    const text = (message.body || '').trim();
    const contact = await message.getContact();
    const username = contact.pushname || contact.name || contact.number || 'Unknown user';

    if (!text) return;

    if (text.startsWith(prefix)) {
      const [rawCommand, ...args] = text.slice(prefix.length).trim().split(/\s+/);
      const command = (rawCommand || '').toLowerCase();
      const handler = commands.get(command);

      if (!handler) {
        logger.info(`Invalid command "${command}" from ${username}`);
        await message.reply(`I do not recognize that command. Send ${prefix}help to see what I can do.`);
        return;
      }

      await handler({
        message,
        args,
        username,
        userId: message.author || message.from,
        prefix,
        quizService,
        sheetsService,
        stateStore,
        explanationFlow,
      });
      return;
    }

    const chatId = message.from;

    // If this chat is currently in the shared post-answer Explanation phase
    // (only happens after a question's timer actually runs out — see
    // quizService.js / explanationFlow.js), route non-command messages
    // there instead of treating them as quiz answers. "next" advances the
    // quiz immediately; anything else is treated as a follow-up question
    // for the AI tutor.
    if (stateStore && explanationFlow && stateStore.getPhase(chatId) === 'explanation') {
      const handled = await explanationFlow.handleMessage({
        chatId,
        text,
        reply: message.reply.bind(message),
        userId: message.author || message.from,
      });
      if (handled) return;
    }

    await quizService.handleAnswer({
      message,
      answerText: text,
      username,
      userId: message.author || message.from,
    });
  }

  return { handleMessage };
}

module.exports = { createCommandRouter };