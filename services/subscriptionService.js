const DEFAULT_FREE_DAILY_QUIZ_LIMIT = 2;
const DEFAULT_FREE_FOLLOWUPS_PER_QUESTION = 3;
const DEFAULT_FREE_REVIEW_LIMIT = 5;

function createSubscriptionService({
  db,
  freeDailyQuizLimit = Number(process.env.FREE_DAILY_QUIZ_LIMIT || DEFAULT_FREE_DAILY_QUIZ_LIMIT),
  freeFollowupsPerQuestion = Number(process.env.FREE_FOLLOWUPS_PER_QUESTION || DEFAULT_FREE_FOLLOWUPS_PER_QUESTION),
  freeReviewLimit = Number(process.env.FREE_REVIEW_LIMIT || DEFAULT_FREE_REVIEW_LIMIT),
} = {}) {
  function getProfile(userId) {
    return db.getUserProfile(userId);
  }

  function getStatus(userId) {
    return db.getSubscriptionStatus(userId);
  }

  function isPremium(userId) {
    return getStatus(userId).isPremium;
  }

  function canStartQuiz(userId) {
    if (isPremium(userId)) return { allowed: true, plan: 'premium' };

    const usedToday = db.countQuizSessionsForDate(userId);
    if (usedToday < freeDailyQuizLimit) {
      return {
        allowed: true,
        plan: 'free',
        usedToday,
        remainingToday: freeDailyQuizLimit - usedToday,
      };
    }

    return {
      allowed: false,
      plan: 'free',
      usedToday,
      limit: freeDailyQuizLimit,
      message: upgradeMessage('daily_quiz_limit'),
      promptType: 'daily_quiz_limit',
    };
  }

  function canAskFollowUp(userId, followUpCount) {
    if (isPremium(userId)) return { allowed: true, plan: 'premium' };

    if (followUpCount <= freeFollowupsPerQuestion) {
      return {
        allowed: true,
        plan: 'free',
        remaining: freeFollowupsPerQuestion - followUpCount,
      };
    }

    return {
      allowed: false,
      plan: 'free',
      limit: freeFollowupsPerQuestion,
      message: upgradeMessage('You have reached today\'s limit for this feature.'),
    };
  }

  function reviewLimitFor(userId, requestedLimit) {
    if (isPremium(userId)) {
      return {
        allowed: true,
        limit: clamp(Number(requestedLimit || 20), 1, 50),
        plan: 'premium',
      };
    }

    const limit = clamp(Number(requestedLimit || freeReviewLimit), 1, freeReviewLimit);
    const requestedTooMuch = Number(requestedLimit || 0) > freeReviewLimit;

    return {
      allowed: !requestedTooMuch,
      limit,
      plan: 'free',
      message: requestedTooMuch
        ? upgradeMessage(`Free review is limited to your latest ${freeReviewLimit} wrong answers.`)
        : null,
    };
  }

  function requirePremium(featureName) {
    return {
      allowed: false,
      message: upgradeMessage(`${featureName} is available on StudyPal Premium.`),
    };
  }

  function upgradeMessage(reason) {
    if (reason === 'daily_quiz_limit') {
      return dailyQuizLimitPrompt();
    }

    return [
      `🎓 ${reason}`,
      '',
      'Upgrade to StudyPal Premium to enjoy:',
      '',
      '- Unlimited AI tutoring',
      '- Unlimited quizzes',
      '- Advanced progress insights',
      '- Personalized study recommendations',
      '',
      'Reply UPGRADE to view available subscription plans.',
    ].join('\n');
  }

  function dailyQuizLimitPrompt() {
    return [
      "🎓 You've completed today's free quiz sessions.",
      '',
      'Upgrade to StudyPal Premium and enjoy:',
      '',
      '• Unlimited quiz sessions',
      '• Unlimited AI tutoring',
      '• Advanced study insights',
      '• Personalized learning recommendations',
      '',
      'Would you like to upgrade?',
      '',
      '1️⃣ Yes',
      '',
      '2️⃣ No',
    ].join('\n');
  }

  function planSummary(userId) {
    const profile = getProfile(userId);
    const status = getStatus(userId);

    return {
      ...profile,
      activePlan: status.plan,
      isPremium: status.isPremium,
      isExpired: status.isExpired,
      freeDailyQuizLimit,
      freeFollowupsPerQuestion,
      freeReviewLimit,
    };
  }

  return {
    getProfile,
    getStatus,
    isPremium,
    canStartQuiz,
    canAskFollowUp,
    reviewLimitFor,
    requirePremium,
    upgradeMessage,
    dailyQuizLimitPrompt,
    planSummary,
  };
}

function clamp(value, min, max) {
  const number = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, number));
}

module.exports = { createSubscriptionService };
