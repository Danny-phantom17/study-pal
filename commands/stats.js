function createStatsCommand(db) {
  return async function handleStatsCommand({ message, userId }) {
    const stats = db.getPersonalStats(userId);

    if (!stats.totalQuizzes) {
      await message.reply('No stats yet. Complete a private quiz first with !quiz <subject>.');
      return;
    }

    await message.reply([
      '*Personal Statistics*',
      `Total quizzes completed: ${stats.totalQuizzes}`,
      `Total questions answered: ${stats.totalQuestions}`,
      `Average score: ${formatPercent(stats.averageScore)}`,
      `Highest score: ${formatPercent(stats.highestScore)}`,
      `Best subject: ${stats.bestSubject ? capitalize(stats.bestSubject) : 'Not enough data yet'}`,
      `Current study streak: ${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}`,
      `Longest study streak: ${stats.longestStreak} day${stats.longestStreak === 1 ? '' : 's'}`,
    ].join('\n'));
  };
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

module.exports = { createStatsCommand };
