function createBadgesCommand(db) {
  return async function handleBadgesCommand({ message, userId }) {
    const badges = db.getAchievements(userId);

    if (!badges.length) {
      await message.reply('No achievements unlocked yet. Complete your first quiz to earn First Quiz.');
      return;
    }

    const lines = ['*Achievements*'];
    badges.forEach((badge) => {
      lines.push(`- ${badge.badge_name} (${badge.unlocked_at.slice(0, 10)})`);
    });

    await message.reply(lines.join('\n'));
  };
}

module.exports = { createBadgesCommand };
