const { normalizeSubject, getAvailableSubjects } = require('../services/questionService');

async function handleQuizCommand({ message, args, quizService, prefix }) {
  const subject = normalizeSubject(args[0]);
  const topic = args.slice(1).join(' ').trim();

  if (!subject) {
    await message.reply(
      `Please choose a subject: ${getAvailableSubjects().join(', ')}.\nExample: ${prefix}quiz physics electricity`
    );
    return;
  }

  if (topic) {
    await message.reply(`Searching for 50 JAMB ${subject} questions on "${topic}". Give me a moment...`);
  }

  const result = await quizService.startQuiz({
    chatId: message.from,
    subject,
    topic,
    reply: (text) => message.reply(text),
  });

  if (!result.started) {
    await message.reply(result.message);
  }
}

module.exports = { handleQuizCommand };
