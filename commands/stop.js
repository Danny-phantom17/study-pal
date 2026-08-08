async function handleStopCommand({ message, quizService, userId, pendingSubjectSelections }) {
  // If the user was in the middle of choosing a quiz subject from the menu
  // (no quiz has actually started yet), "stop" should cancel that too —
  // otherwise a stray leftover number they send later would still be
  // interpreted as a subject selection.
  if (pendingSubjectSelections && userId) {
    pendingSubjectSelections.delete(userId);
  }

  const result = await quizService.stopQuiz(message.from);

  await message.reply(result.message);
}

module.exports = { handleStopCommand };