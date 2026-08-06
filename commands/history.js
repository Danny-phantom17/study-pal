function createHistoryCommand(db) {
  return async function handleHistoryCommand({ message, userId }) {
    const history = db.getQuizHistory(userId, 12);

    if (!history.length) {
      await message.reply('No completed quizzes yet. Send !quiz biology to start your first private session.');
      return;
    }

    const lines = ['*Quiz History*'];
    let currentDate = null;

    history.forEach((session) => {
      const date = formatDate(session.completed_at);
      if (date !== currentDate) {
        currentDate = date;
        lines.push('', date);
      }

      lines.push(`${capitalize(session.subject)} - ${session.correct_count}/${session.total_questions} (${formatPercent(session.percentage)})`);
    });

    await message.reply(lines.join('\n'));
  };
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

module.exports = { createHistoryCommand };
