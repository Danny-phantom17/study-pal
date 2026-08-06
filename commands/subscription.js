function createPlanCommand(subscriptionService) {
  return async function handlePlanCommand({ message, userId }) {
    const summary = subscriptionService.planSummary(userId);
    const lines = [
      '*StudyPal Profile*',
      `Name: ${summary.name}`,
      `Phone: ${summary.phoneNumber || 'Unknown'}`,
      `Role: ${capitalize(summary.role)}`,
      `Plan: ${summary.activePlan === 'premium' ? 'Premium' : 'Free'}`,
      summary.subscriptionExpiresAt ? `Expiry: ${summary.subscriptionExpiresAt.slice(0, 10)}` : null,
      summary.isExpired ? 'Status: Premium expired, currently using Free' : null,
      '',
      '*Free includes*',
      `- Up to ${summary.freeDailyQuizLimit} quiz sessions per day`,
      '- AI explanations for every answered question',
      '- Quiz history, stats, streaks, goals, weekly reports, badges',
      '',
      '*Premium adds*',
      '- Unlimited AI follow-up questions',
      '- Unlimited quiz sessions',
      '- Unlimited review of previous quizzes',
      '- Personalized study recommendations',
      '- Advanced performance analytics',
      '- Priority AI responses during busy periods',
      '- Early access to new features',
      '',
      'Reply UPGRADE to view subscription options.',
    ].filter(Boolean);

    await message.reply(lines.join('\n'));
  };
}

function createUpgradeCommand() {
  return async function handleUpgradeCommand({ message }) {
    await message.reply(formatUpgradePlans());
  };
}

function createAnalyticsCommand(subscriptionService, db) {
  return async function handleAnalyticsCommand({ message, userId }) {
    if (!subscriptionService.isPremium(userId)) {
      await message.reply(subscriptionService.requirePremium('Advanced performance analytics').message);
      return;
    }

    const analytics = db.getAdvancedAnalytics(userId);
    if (!analytics.subjects.length) {
      await message.reply('Complete a few quizzes first, then StudyPal can build your advanced analytics.');
      return;
    }

    const subjectLines = analytics.subjects.slice(0, 5).map((subject) => {
      return `- ${capitalize(subject.subject)}: ${Math.round(subject.average_score)}% avg, ${subject.questions_answered} questions`;
    });

    const weakLines = analytics.weakestTopics.length
      ? analytics.weakestTopics.map((item) => `- ${capitalize(item.subject)} / ${item.topic}: ${item.misses} misses`)
      : ['- No weak topics recorded yet'];

    await message.reply([
      '*Advanced Analytics*',
      '',
      '*Subject performance*',
      ...subjectLines,
      '',
      '*Topics to revise*',
      ...weakLines,
    ].join('\n'));
  };
}

function createRecommendCommand(subscriptionService, db) {
  return async function handleRecommendCommand({ message, userId }) {
    if (!subscriptionService.isPremium(userId)) {
      await message.reply(subscriptionService.requirePremium('Personalized study recommendations').message);
      return;
    }

    const stats = db.getPersonalStats(userId);
    const analytics = db.getAdvancedAnalytics(userId);

    if (!stats.totalQuizzes) {
      await message.reply('Start with one quiz in any subject. After that, StudyPal can recommend your next study move.');
      return;
    }

    const weakest = analytics.weakestTopics[0];
    const recommendation = weakest
      ? `Focus on ${capitalize(weakest.subject)}${weakest.topic !== 'general' ? ` (${weakest.topic})` : ''}. Review your wrong answers, then take a 20-question quiz on that topic.`
      : `Keep building momentum in ${capitalize(stats.bestSubject || 'your strongest subject')} and try one harder quiz tomorrow.`;

    await message.reply([
      '*Personalized Recommendation*',
      recommendation,
      '',
      `Current average: ${Math.round(stats.averageScore)}%`,
      `Study streak: ${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}`,
    ].join('\n'));
  };
}

function createAdminSubscriptionCommand(db) {
  return async function handleAdminSubscriptionCommand({ message, args, userId, prefix }) {
    if (!db.hasManagementAccess(userId)) {
      await message.reply('Only the StudyPal admin can update subscriptions.');
      return;
    }

    const [phone, plan, expiry] = args;
    if (!phone || !plan) {
      await message.reply(`Usage: ${prefix}adminplan <phone> <free|premium> [YYYY-MM-DD]`);
      return;
    }

    const normalizedPlan = String(plan).toLowerCase() === 'premium' ? 'premium' : 'free';
    const targetUserId = `${String(phone).replace(/\D/g, '')}@c.us`;
    const expiresAt = normalizedPlan === 'premium'
      ? normalizeExpiry(expiry)
      : null;

    db.upsertUser(targetUserId, null);
    db.updateSubscription({ userId: targetUserId, plan: normalizedPlan, expiresAt });

    await message.reply([
      'Subscription updated.',
      `Student: ${targetUserId}`,
      `Plan: ${normalizedPlan}`,
      expiresAt ? `Expiry: ${expiresAt.slice(0, 10)}` : null,
      normalizedPlan === 'premium' ? 'Premium features unlocked immediately and saved in the database.' : null,
    ].filter(Boolean).join('\n'));
  };
}

function createAdminRoleCommand(db) {
  return async function handleAdminRoleCommand({ message, args, userId, prefix }) {
    if (!db.hasManagementAccess(userId)) {
      await message.reply('Only the StudyPal owner or an admin can update user roles.');
      return;
    }

    const [phone, role, ...nameParts] = args;
    if (!phone || !role) {
      await message.reply(`Usage: ${prefix}adminrole <phone> <student|admin|vip> [name]`);
      return;
    }

    const normalizedRole = String(role).toLowerCase();
    if (!['student', 'admin', 'vip'].includes(normalizedRole)) {
      await message.reply('Role must be one of: student, admin, vip. The owner role cannot be assigned here.');
      return;
    }

    const targetUserId = `${String(phone).replace(/\D/g, '')}@c.us`;
    const username = nameParts.join(' ').trim() || null;

    try {
      db.updateUserRole({ userId: targetUserId, role: normalizedRole, username });
    } catch (error) {
      await message.reply(error.message);
      return;
    }

    await message.reply([
      'User role updated.',
      `Student: ${targetUserId}`,
      `Role: ${normalizedRole}`,
      username ? `Name: ${username}` : null,
    ].filter(Boolean).join('\n'));
  };
}

function formatUpgradePlans() {
  return [
    '*StudyPal Premium*',
    '',
    'Premium gives you:',
    '- Unlimited AI tutoring',
    '- Unlimited quizzes',
    '- Unlimited review of previous quizzes',
    '- Personalized study recommendations',
    '- Advanced progress insights',
    '- Priority AI response during busy periods',
    '- Early access to new features',
    '',
    '*Payment Information*',
    'Payment Platform: PalmPay',
    'Account Name: Daniel Godwin Effiong',
    'Account Number: 7044438532',
    '',
    'After payment, send your payment receipt or transaction reference for verification.',
    'Once payment is confirmed, your account will be updated from Free to Premium, an expiry date will be set, and all Premium features will unlock immediately.',
  ].join('\n');
}

function normalizeExpiry(value) {
  if (!value) {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString();
  }

  return new Date(`${value}T23:59:59.000Z`).toISOString();
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

module.exports = {
  createPlanCommand,
  createUpgradeCommand,
  createAnalyticsCommand,
  createRecommendCommand,
  createAdminSubscriptionCommand,
  createAdminRoleCommand,
  formatUpgradePlans,
};
