function createGoalCommand(db) {
  return async function handleGoalCommand({ message, args, userId }) {
    const requestedGoal = Number(args[0]);

    if (Number.isInteger(requestedGoal) && requestedGoal > 0 && requestedGoal <= 500) {
      db.setDailyGoal(userId, requestedGoal);
    }

    const progress = db.getDailyGoalProgress(userId);
    const lines = [
      "*Today's Goal*",
      `${progress.goalQuestions} questions`,
      '',
      'Progress',
      `${progress.answered} / ${progress.goalQuestions}`,
      `${Math.round(progress.percentage)}% complete`,
    ];

    if (args[0] && (!Number.isInteger(requestedGoal) || requestedGoal <= 0 || requestedGoal > 500)) {
      lines.push('', 'Send a number from 1 to 500, for example: !goal 20');
    }

    await message.reply(lines.join('\n'));
  };
}

module.exports = { createGoalCommand };
