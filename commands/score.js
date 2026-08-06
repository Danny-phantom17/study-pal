async function handleScoreCommand({ message, userId, username, sheetsService, db }) {
  if (db) {
    const stats = db.getPersonalStats(userId);
    if (stats.totalQuizzes) {
      await message.reply([
        `${username}, your average quiz score is ${Math.round(stats.averageScore)}%.`,
        `Highest score: ${Math.round(stats.highestScore)}%`,
        `Questions answered: ${stats.totalQuestions}`,
        'Send !stats for the full breakdown.',
      ].join('\n'));
      return;
    }
  }

  const score = await sheetsService.getUserScore(userId);
  await message.reply(`${username}, your current score is ${score} point${score === 1 ? '' : 's'}.`);
}

module.exports = { handleScoreCommand };
