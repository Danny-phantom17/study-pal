function createReviewCommand(db, subscriptionService) {
  return async function handleReviewCommand({ message, args, userId }) {
    const requestedLimit = args[0] ? Number(args[0]) : null;
    const access = subscriptionService
      ? subscriptionService.reviewLimitFor(userId, requestedLimit)
      : { allowed: true, limit: requestedLimit || 5 };

    if (!access.allowed) {
      await message.reply(access.message);
      return;
    }

    const wrongAnswers = db.getRecentWrongAnswers(userId, access.limit);

    if (!wrongAnswers.length) {
      await message.reply('No wrong answers saved yet. Keep practising and StudyPal will build your review list.');
      return;
    }

    const blocks = wrongAnswers.map((item, index) => {
      const lines = [
        `*${index + 1}. ${capitalize(item.subject)}*`,
        item.topic ? `_Topic: ${item.topic}_` : null,
        item.question_text,
        `Correct answer: ${item.correct_answer}${optionText(item) ? `. ${optionText(item)}` : ''}`,
        item.student_answer ? `Your answer: ${item.student_answer}` : 'Your answer: no answer before time ran out',
        item.explanation_text || 'Explanation will appear here after the AI tutor has generated it.',
        item.memory_tip ? `Memory tip: ${item.memory_tip}` : null,
      ].filter(Boolean);

      return lines.join('\n');
    });

    await message.reply(['*Review Wrong Answers*', ...blocks].join('\n\n'));
  };
}

function optionText(item) {
  const index = String(item.correct_answer || '').toUpperCase().charCodeAt(0) - 65;
  return Array.isArray(item.options) ? item.options[index] : '';
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

module.exports = { createReviewCommand };
