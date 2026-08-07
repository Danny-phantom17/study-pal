const { normalizeSubject, getAvailableSubjects } = require('../services/questionService');

async function handleQuizCommand({ message, args, quizService, prefix, userId, username, pendingUpgradePrompts }) {
  if (message.from.endsWith('@g.us')) {
    await message.reply([
      '*StudyPal private tutor*',
      'Quizzes, scores, progress, explanations, streaks, and achievements happen in your private chat with StudyPal.',
      '',
      `Send me a DM with: ${prefix}quiz biology`,
      'This group stays for questions, discussion, announcements, study tips, and motivation.',
    ].join('\n'));
    return;
  }

  const subject = normalizeSubject(args[0]);
  const topic = args.slice(1).join(' ').trim();

  if (!subject) {
    await message.reply(
      `Please choose a subject: ${getAvailableSubjects().join(', ')}.\nExample: ${prefix}quiz physics electricity`
    );
    return;
  }

  if (topic) {
    await message.reply(`Searching for JAMB ${subject} questions on "${topic}". Give me a moment...`);
  }

  const result = await quizService.startQuiz({
    chatId: message.from,
    userId,
    username,
    subject,
    topic,
    reply: (text) => message.reply(text),
  });

  if (!result.started) {
    if (result.reason === 'daily_quiz_limit' && pendingUpgradePrompts) {
      pendingUpgradePrompts.set(userId, true);
    }
    await message.reply(result.message);
  }
}

module.exports = { handleQuizCommand };
