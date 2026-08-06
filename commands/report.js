function createReportCommand(db) {
  return async function handleReportCommand({ message, userId }) {
    const report = db.getWeeklyReport(userId);
    const change = report.averageScoreChange;
    const changeText = change === 0 ? 'no change' : `${change > 0 ? '+' : ''}${Math.round(change)}%`;

    await message.reply([
      '*Weekly Report*',
      `Days studied: ${report.daysStudied}`,
      `Questions answered: ${report.questionsAnswered}`,
      `Average score: ${Math.round(report.averageScore)}%`,
      `Best-performing subject: ${report.bestSubject ? capitalize(report.bestSubject) : 'Not enough data yet'}`,
      `Progress vs previous week: ${changeText}`,
    ].join('\n'));
  };
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

module.exports = { createReportCommand };
