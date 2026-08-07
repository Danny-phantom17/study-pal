const DEFAULT_FREE_FOLLOWUPS_PER_QUESTION = 3;
const DEFAULT_FREE_REVIEW_LIMIT = 5;
const DEFAULT_FREE_DAILY_AI_LIMIT = 10;
const DEFAULT_FREE_DAILY_QUESTION_LIMIT = 5;
const DEFAULT_TRIAL_DAYS = 7;
const DEFAULT_TRIAL_DAILY_QUESTION_LIMIT = 20;
const DEFAULT_TRIAL_DAILY_SUBJECT_LIMIT = 2;
const DEFAULT_TRIAL_DAILY_AI_LIMIT = 20;

function createSubscriptionService({
  db,
  freeFollowupsPerQuestion = Number(process.env.FREE_FOLLOWUPS_PER_QUESTION || DEFAULT_FREE_FOLLOWUPS_PER_QUESTION),
  freeReviewLimit = Number(process.env.FREE_REVIEW_LIMIT || DEFAULT_FREE_REVIEW_LIMIT),
  freeDailyAiLimit = Number(process.env.FREE_DAILY_AI_LIMIT || DEFAULT_FREE_DAILY_AI_LIMIT),
  freeDailyQuestionLimit = Number(process.env.FREE_DAILY_QUESTION_LIMIT || DEFAULT_FREE_DAILY_QUESTION_LIMIT),
  trialDays = Number(process.env.TRIAL_DAYS || DEFAULT_TRIAL_DAYS),
  trialDailyQuestionLimit = Number(process.env.TRIAL_DAILY_QUESTION_LIMIT || DEFAULT_TRIAL_DAILY_QUESTION_LIMIT),
  trialDailySubjectLimit = Number(process.env.TRIAL_DAILY_SUBJECT_LIMIT || DEFAULT_TRIAL_DAILY_SUBJECT_LIMIT),
  trialDailyAiLimit = Number(process.env.TRIAL_DAILY_AI_LIMIT || DEFAULT_TRIAL_DAILY_AI_LIMIT),
} = {}) {
  function getProfile(userId) {
    return db.getUserProfile(userId);
  }

  function getStatus(userId) {
    return db.getSubscriptionStatus(userId);
  }

  function getAccess(userId, now = new Date()) {
    const profile = getProfile(userId);
    const status = getStatus(userId);

    if (status.isPremium) {
      return {
        key: status.role === 'student' ? 'premium' : status.role,
        label: status.role === 'student' ? 'Premium' : capitalize(status.role),
        unlimited: true,
        aiAccess: 'Unlimited',
        status,
        profile,
      };
    }

    const trialEndsAt = getTrialEndsAt(profile.firstSeen, trialDays);
    if (trialEndsAt && trialEndsAt > now) {
      return {
        key: 'trial',
        label: '7-Day Free Trial',
        unlimited: false,
        dailyQuestionLimit: trialDailyQuestionLimit,
        dailySubjectLimit: trialDailySubjectLimit,
        dailyAiLimit: trialDailyAiLimit,
        aiAccess: 'Enabled',
        trialEndsAt,
        status,
        profile,
      };
    }

    return {
      key: 'free',
      label: 'Free',
      unlimited: false,
      dailyQuestionLimit: freeDailyQuestionLimit,
      dailySubjectLimit: null,
      dailyAiLimit: freeDailyAiLimit,
      aiAccess: freeDailyAiLimit > 0 ? 'Limited' : 'Disabled',
      trialEndsAt,
      status,
      profile,
    };
  }

  function isPremium(userId) {
    return getAccess(userId).unlimited;
  }

  function canStartQuiz(userId, { subject } = {}) {
    const access = getAccess(userId);
    if (access.unlimited) return { allowed: true, plan: access.key, unlimited: true };

    const usedQuestionsToday = db.countQuestionsAnsweredForDate(userId);
    const remainingQuestionsToday = Math.max(0, access.dailyQuestionLimit - usedQuestionsToday);

    if (remainingQuestionsToday <= 0) {
      return {
        allowed: false,
        plan: access.key,
        usedToday: usedQuestionsToday,
        limit: access.dailyQuestionLimit,
        message: dailyQuestionLimitPrompt(access),
        promptType: 'daily_quiz_limit',
      };
    }

    if (access.key === 'trial' && subject) {
      const usedSubjects = db.listSubjectsAnsweredForDate(userId).map(normalizeSubjectName);
      const requestedSubject = normalizeSubjectName(subject);
      const isNewSubjectToday = requestedSubject && !usedSubjects.includes(requestedSubject);

      if (isNewSubjectToday && usedSubjects.length >= access.dailySubjectLimit) {
        return {
          allowed: false,
          plan: access.key,
          usedSubjects,
          limit: access.dailySubjectLimit,
          message: trialSubjectLimitPrompt(access, usedSubjects),
          promptType: 'trial_subject_limit',
        };
      }
    }

    return {
      allowed: true,
      plan: access.key,
      usedToday: usedQuestionsToday,
      remainingToday: remainingQuestionsToday,
    };
  }

  function canAskFollowUp(userId, followUpCount) {
    const access = getAccess(userId);
    if (access.unlimited) return { allowed: true, plan: access.key };

    if (followUpCount <= freeFollowupsPerQuestion) {
      return {
        allowed: true,
        plan: access.key,
        remaining: freeFollowupsPerQuestion - followUpCount,
      };
    }

    return {
      allowed: false,
      plan: access.key,
      limit: freeFollowupsPerQuestion,
      message: upgradeMessage('You have reached the follow-up limit for this question.'),
    };
  }

  function canUseAiMessage(userId) {
    const access = getAccess(userId);
    if (access.unlimited) return { allowed: true, plan: access.key, unlimited: true };
    if (access.dailyAiLimit <= 0) {
      return {
        allowed: false,
        plan: access.key,
        limit: 0,
        message: dailyAiLimitMessage(access),
        promptType: 'daily_ai_limit',
      };
    }

    const usedToday = db.getAiUsageForDate(userId);
    if (usedToday < access.dailyAiLimit) {
      return {
        allowed: true,
        plan: access.key,
        usedToday,
        remainingToday: access.dailyAiLimit - usedToday,
      };
    }

    return {
      allowed: false,
      plan: access.key,
      usedToday,
      limit: access.dailyAiLimit,
      message: dailyAiLimitMessage(access),
      promptType: 'daily_ai_limit',
    };
  }

  function tryConsumeAiMessage(userId) {
    const access = canUseAiMessage(userId);
    if (!access.allowed) return access;
    if (access.unlimited) return access;

    const usedToday = db.incrementAiUsageForDate(userId);
    const tier = getAccess(userId);
    return {
      ...access,
      usedToday,
      remainingToday: Math.max(0, tier.dailyAiLimit - usedToday),
    };
  }

  function quizQuestionLimitFor(userId, requestedLimit) {
    const fallback = Number(requestedLimit || 20);
    const access = getAccess(userId);
    if (access.unlimited) return clamp(fallback, 1, 50);

    const usedQuestionsToday = db.countQuestionsAnsweredForDate(userId);
    const remainingQuestionsToday = Math.max(0, access.dailyQuestionLimit - usedQuestionsToday);
    if (remainingQuestionsToday <= 0) return 0;

    return clamp(Math.min(fallback, remainingQuestionsToday), 1, fallback);
  }

  function reviewLimitFor(userId, requestedLimit) {
    const access = getAccess(userId);
    if (access.unlimited) {
      return {
        allowed: true,
        limit: clamp(Number(requestedLimit || 20), 1, 50),
        plan: access.key,
      };
    }

    const limit = clamp(Number(requestedLimit || freeReviewLimit), 1, freeReviewLimit);
    const requestedTooMuch = Number(requestedLimit || 0) > freeReviewLimit;

    return {
      allowed: !requestedTooMuch,
      limit,
      plan: access.key,
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
    return [
      reason,
      '',
      'Upgrade to StudyPal Premium to enjoy:',
      '',
      '- Unlimited questions',
      '- Unlimited subjects',
      '- Unlimited AI Tutor messages and explanations',
      '- Unlimited follow-up questions',
      '- Advanced analytics and personalized recommendations',
      '',
      'Price: \u20A63,000',
      '',
      'Type subscribe to view payment details.',
    ].join('\n');
  }

  function dailyQuestionLimitPrompt(access) {
    return [
      `You have used today's ${access.label} question limit.`,
      '',
      `Daily limit: ${access.dailyQuestionLimit} questions`,
      '',
      'Upgrade to StudyPal Premium for unlimited questions, unlimited subjects, and unlimited AI.',
      '',
      'Type subscribe to view payment details.',
    ].join('\n');
  }

  function trialSubjectLimitPrompt(access, usedSubjects) {
    return [
      'You have reached today\'s trial subject limit.',
      '',
      `Trial limit: ${access.dailySubjectLimit} subjects per day`,
      usedSubjects.length ? `Subjects already used today: ${usedSubjects.map(capitalize).join(', ')}` : null,
      '',
      'You can continue practising those subjects today, or upgrade to Premium for unlimited subjects.',
      '',
      'Type subscribe to view payment details.',
    ].filter(Boolean).join('\n');
  }

  function dailyAiLimitMessage(access = { label: 'Free', dailyAiLimit: freeDailyAiLimit }) {
    return [
      'Daily AI limit reached.',
      '',
      `Current plan: ${access.label || 'Free'}`,
      access.dailyAiLimit ? `Daily AI limit: ${access.dailyAiLimit} messages` : null,
      '',
      'Upgrade to StudyPal Premium for unlimited AI conversations, explanations, and AI-powered quizzes.',
      '',
      'Type subscribe to view payment details.',
    ].filter(Boolean).join('\n');
  }

  function planSummary(userId) {
    const access = getAccess(userId);
    const usedQuestionsToday = access.unlimited ? 0 : db.countQuestionsAnsweredForDate(userId);
    const remainingQuestionsToday = access.unlimited
      ? null
      : Math.max(0, access.dailyQuestionLimit - usedQuestionsToday);
    const usedSubjectsToday = access.key === 'trial' ? db.listSubjectsAnsweredForDate(userId) : [];
    const usedAiToday = access.unlimited ? 0 : db.getAiUsageForDate(userId);
    const remainingAiToday = access.unlimited
      ? null
      : Math.max(0, access.dailyAiLimit - usedAiToday);

    return {
      ...access.profile,
      activePlan: access.key,
      planLabel: access.label,
      isPremium: access.unlimited,
      isExpired: access.status.isExpired,
      statusLabel: access.status.isExpired ? 'Expired' : 'Active',
      subscriptionExpiresAt: access.profile.subscriptionExpiresAt,
      trialEndsAt: access.trialEndsAt ? access.trialEndsAt.toISOString() : null,
      freeFollowupsPerQuestion,
      freeReviewLimit,
      freeDailyAiLimit,
      freeDailyQuestionLimit,
      trialDays,
      trialDailyQuestionLimit,
      trialDailySubjectLimit,
      trialDailyAiLimit,
      dailyQuestionLimit: access.dailyQuestionLimit || null,
      usedQuestionsToday,
      remainingQuestionsToday,
      usedSubjectsToday,
      remainingSubjectsToday: access.key === 'trial'
        ? Math.max(0, trialDailySubjectLimit - usedSubjectsToday.length)
        : null,
      aiAccess: access.aiAccess,
      dailyAiLimit: access.dailyAiLimit || null,
      usedAiToday,
      remainingAiToday,
    };
  }

  return {
    getProfile,
    getStatus,
    getAccess,
    isPremium,
    canStartQuiz,
    canAskFollowUp,
    canUseAiMessage,
    tryConsumeAiMessage,
    quizQuestionLimitFor,
    reviewLimitFor,
    requirePremium,
    upgradeMessage,
    dailyQuestionLimitPrompt,
    dailyAiLimitMessage,
    planSummary,
  };
}

function getTrialEndsAt(firstSeen, trialDays) {
  if (!firstSeen || !trialDays || trialDays <= 0) return null;
  const firstSeenDate = new Date(firstSeen);
  if (Number.isNaN(firstSeenDate.getTime())) return null;

  const endsAt = new Date(firstSeenDate);
  endsAt.setDate(endsAt.getDate() + trialDays);
  return endsAt;
}

function normalizeSubjectName(subject) {
  return String(subject || '').trim().toLowerCase();
}

function clamp(value, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : min;
  return Math.max(min, Math.min(max, number));
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

module.exports = { createSubscriptionService };
