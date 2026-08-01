async function handleStopCommand({ message, quizService }) {
  const result = await quizService.stopQuiz(message.from);

  await message.reply(result.message);
}

module.exports = { handleStopCommand };