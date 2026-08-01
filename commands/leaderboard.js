async function handleLeaderboardCommand({ message, sheetsService }) {
  const leaderboard = await sheetsService.getLeaderboard();

  if (!leaderboard.length) {
    await message.reply('No scores yet. Start a quiz with !quiz <subject>.');
    return;
  }

  const lines = leaderboard.map((entry, index) => {
    return `${index + 1}. ${entry.username} - ${entry.points} point${entry.points === 1 ? '' : 's'}`;
  });

  await message.reply(['*Leaderboard*', ...lines].join('\n'));
}

module.exports = { handleLeaderboardCommand };
