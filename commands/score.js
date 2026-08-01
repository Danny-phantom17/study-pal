async function handleScoreCommand({ message, userId, username, sheetsService }) {
  const score = await sheetsService.getUserScore(userId);
  await message.reply(`${username}, your current score is ${score} point${score === 1 ? '' : 's'}.`);
}

module.exports = { handleScoreCommand };
