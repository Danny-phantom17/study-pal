function createStreakCommand(db) {
  return async function handleStreakCommand({ message, userId }) {
    const streak = db.getStreak(userId);

    await message.reply([
      '*Study Streak*',
      `${streak.currentStreak} day${streak.currentStreak === 1 ? '' : 's'}`,
      '',
      `Longest streak: ${streak.longestStreak} day${streak.longestStreak === 1 ? '' : 's'}`,
      streak.lastActiveDate ? `Last studied: ${streak.lastActiveDate}` : 'Complete a quiz to start your streak.',
    ].join('\n'));
  };
}

module.exports = { createStreakCommand };
