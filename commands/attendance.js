async function handleAttendanceCommand({ message, sheetsService }) {
  const records = await sheetsService.getRecentAttendance(10);

  if (!records.length) {
    await message.reply('No attendance has been recorded yet.');
    return;
  }

  const lines = records.map((record) => {
    return `${record.date} - ${record.username} quized his/herself in ${record.subject}`;
  });

  await message.reply(['*Recent Attendance*', ...lines].join('\n'));
}

module.exports = { handleAttendanceCommand };
