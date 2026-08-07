const { getQuestions } = require('./questionService');
const { formatQuestion } = require('../utils/formatters');
const { logger } = require('../utils/logger');

function createQuizService({
  sheetsService,
  db = null,
  timeLimitSeconds,
  pointsPerCorrectAnswer,
  maxAttemptsPerQuestion = 2,
  questionLimit = 20,
  explanationFlow = null,
  sendDirectMessage = null,
  subscriptionService = null,
  onQuizStarted = null,
}) {
  const activeQuizzes = new Map();

  async function startQuiz({ chatId, userId, username, subject, topic, reply }) {
    if (activeQuizzes.has(chatId)) {
      return {
        started: false,
        message: 'A quiz is already running in this chat. Finish it before starting another one.',
      };
    }

    if (subscriptionService && userId) {
      const access = subscriptionService.canStartQuiz(userId, { subject });
      if (!access.allowed) {
        return {
          started: false,
          message: access.message,
          reason: access.promptType || 'subscription_limit',
        };
      }
    }

    const effectiveQuestionLimit = subscriptionService && userId
      ? subscriptionService.quizQuestionLimitFor(userId, questionLimit)
      : questionLimit;

    if (effectiveQuestionLimit <= 0) {
      return {
        started: false,
        message: 'You have used today\'s question limit. Type subscribe to upgrade to unlimited access.',
        reason: 'daily_quiz_limit',
      };
    }

    const questions = shuffle(await getQuestions({
      chatId,
      subject,
      topic,
      limit: effectiveQuestionLimit,
      sheetsService,
    }));

    if (!questions.length) {
      return {
        started: false,
        message: `I could not find questions for ${subject}${topic ? ` on "${topic}"` : ''}. Try another topic.`,
      };
    }

    const state = {
      chatId,
      db,
      userId,
      username,
      subject,
      topic,
      questions,
      currentIndex: 0,
      reply,
      timer: null,
      attemptsByUser: new Map(),
      scoredQuestionKeys: new Set(),
      correctQuestionIds: new Set(),
      wrongAnswersByQuestion: new Map(),
      answeredQuestionIds: new Set(),
      startedAt: new Date(),
      questionStartedAt: null,
      isActive: true,
    };

    activeQuizzes.set(chatId, state);
    logger.info(`Started ${subject} quiz in chat ${chatId}${topic ? ` on topic "${topic}"` : ''}`);

    // Lets the daily reminder feature know a quiz has started today, so it
    // stops nagging this chat for the rest of the day. Safe to call even
    // when no reminder service is configured (onQuizStarted stays null).
    if (onQuizStarted) {
      onQuizStarted(chatId);
    }

    await safeReply(reply, `Starting your private ${questions.length}-question ${subject} quiz${topic ? ` on "${topic}"` : ''}. You have ${timeLimitSeconds} seconds per question.`);
    await sendCurrentQuestion(state);

    return { started: true };
  }

  async function handleAnswer({ message, answerText, username, userId }) {
    const chatId = message.from;
    const state = activeQuizzes.get(chatId);

    if (!state || !state.isActive) return false;

    const question = state.questions[state.currentIndex];
    const userQuestionKey = `${userId}:${question.id}`;
    const attemptsUsed = state.attemptsByUser.get(userId) || 0;
    const attemptNumber = attemptsUsed + 1;
    const timeTakenSeconds = state.questionStartedAt
      ? (Date.now() - state.questionStartedAt) / 1000
      : null;

    await sheetsService.recordAttendance({
      userId,
      username,
      subject: state.subject,
    });

    if (attemptsUsed >= maxAttemptsPerQuestion) {
      if (explanationFlow) {
        const handled = await explanationFlow.handlePersonalFollowUp({
          reply: message.reply.bind(message),
          question,
          subject: state.subject,
          userId,
          userMessage: answerText,
        });
        if (handled) return true;
      }
      await safeReply(message.reply.bind(message), `${username}, you've used all ${maxAttemptsPerQuestion} attempts for this question. Wait for the next one.`);
      return true;
    }

    const isCorrect = isCorrectAnswer(answerText, question);
    recordStudentAttempt(state, {
      userId,
      username,
      question,
      answerText,
      attemptNumber,
      isCorrect,
      timeTakenSeconds,
    });

    if (!isCorrect) {
      const newAttemptsUsed = attemptsUsed + 1;
      state.attemptsByUser.set(userId, newAttemptsUsed);
      state.wrongAnswersByQuestion.set(question.id, {
        question,
        studentAnswer: answerText,
        createdAt: new Date().toISOString(),
      });
      const remaining = maxAttemptsPerQuestion - newAttemptsUsed;

      logger.info(`${username} answered ${question.id} incorrectly (attempt ${newAttemptsUsed}/${maxAttemptsPerQuestion})`);

      if (remaining > 0) {
        await safeReply(message.reply.bind(message), `Not quite, ${username}. You have ${remaining} attempt${remaining === 1 ? '' : 's'} left.`);
      } else {
        await safeReply(message.reply.bind(message), `Not quite, ${username}. You're out of attempts for this question.`);
        await deliverOutcomeExplanation(state, { message, question, outcome: 'wrong', studentAnswer: answerText, userId });
      }
      return true;
    }

    // Correct: mark the user as done with this question so any further
    // attempts (including remaining ones) are blocked.
    state.attemptsByUser.set(userId, maxAttemptsPerQuestion);

    if (state.scoredQuestionKeys.has(userQuestionKey)) {
      await safeReply(message.reply.bind(message), `${username}, this question has already been scored for you.`);
      return;
    }

    const scoreResult = await sheetsService.recordScore({
      userId,
      username,
      subject: state.subject,
      questionId: question.id,
      points: pointsPerCorrectAnswer,
    });

    if (scoreResult.duplicate) {
      await safeReply(message.reply.bind(message), `${username}, this question has already been scored for you.`);
      return;
    }

    state.scoredQuestionKeys.add(userQuestionKey);
    state.correctQuestionIds.add(question.id);
    state.answeredQuestionIds.add(question.id);
    logger.info(`${username} scored ${pointsPerCorrectAnswer} points for ${question.id}`);
    await safeReply(message.reply.bind(message), `Correct, ${username}. +${pointsPerCorrectAnswer} points.`);

    await deliverOutcomeExplanation(state, { message, question, outcome: 'correct', studentAnswer: answerText, userId });
    return true;
  }

  async function sendCurrentQuestion(state) {
    clearExistingTimer(state);

    if (state.currentIndex >= state.questions.length) {
      await finishQuiz(state);
      return;
    }

    state.attemptsByUser = new Map();
    const question = state.questions[state.currentIndex];
    const expectedIndex = state.currentIndex;
    state.questionStartedAt = Date.now();

    await safeReply(state.reply, formatQuestion({
      question,
      subject: state.subject,
      questionNumber: state.currentIndex + 1,
      totalQuestions: state.questions.length,
      timeLimitSeconds,
    }));

    state.timer = setTimeout(async () => {
      // Guard against a stale timer firing after something else has already
      // advanced the quiz (e.g. a duplicate event, or a future !skip command).
      if (!state.isActive || state.currentIndex !== expectedIndex) {
        return;
      }

      logger.info(`Question ${question.id} timed out in chat ${state.chatId}`);
      if (state.userId) {
        recordStudentAttempt(state, {
          userId: state.userId,
          username: state.username,
          question,
          answerText: '',
          attemptNumber: 1,
          isCorrect: false,
          timeTakenSeconds: timeLimitSeconds,
        });
        state.wrongAnswersByQuestion.set(question.id, {
          question,
          studentAnswer: null,
          createdAt: new Date().toISOString(),
        });
      }
      await proceedToNext(state, { outcome: 'timeout', studentAnswer: null, userId: null });
    }, timeLimitSeconds * 1000);
  }

  async function finishQuiz(state) {
    clearExistingTimer(state);
    activeQuizzes.delete(state.chatId);
    state.isActive = false;
    logger.info(`Finished ${state.subject} quiz in chat ${state.chatId}`);
    const summary = saveQuizSummary(state);
    await safeReply(state.reply, formatQuizSummary(summary));
  }

  async function stopQuiz(chatId) {
    const state = activeQuizzes.get(chatId);

    if (!state) {
      return {
        stopped: false,
        message: 'No quiz is currently running in this chat.',
      };
    }

    clearExistingTimer(state);
    state.isActive = false;
    activeQuizzes.delete(chatId);

    // The quiz can be stopped while a per-question "explanation" phase is
    // in progress (e.g. after 2 wrong attempts, or a timeout, in a solo
    // chat). That phase owns its own timer and its own queued `advance()`
    // callback, which closes over this now-deleted `state` and would
    // otherwise still fire `sendCurrentQuestion` on the orphaned state,
    // sending one more question after "Quiz stopped" has already been
    // sent. Cancelling it here — without calling `advance` — is what
    // actually stops that extra message.
    if (explanationFlow) {
      explanationFlow.cancel(chatId);
    }

    logger.info(`Stopped ${state.subject} quiz in chat ${chatId}`);

    return {
      stopped: true,
      message: 'Quiz stopped. Send !quiz <subject> when you are ready to continue studying.',
    };
  }

  async function stopAll() {
    for (const state of activeQuizzes.values()) {
      clearExistingTimer(state);
      state.isActive = false;
    }
    activeQuizzes.clear();
  }

  /**
   * Decides how to deliver an individual outcome's explanation:
   * - Solo chat (DM with the bot, chatId ends in @c.us): there's no group
   *   to keep running for, so give the full paused experience — same
   *   mechanism as a group timeout (explanation, follow-ups, "next").
   * - Group chat (@g.us): stay quiet and non-disruptive — a personal
   *   explanation goes to the group reply AND, if configured, straight to
   *   the member's DM, without touching the shared timer for anyone else.
   */
  async function deliverOutcomeExplanation(state, { message, question, outcome, studentAnswer, userId }) {
    if (!explanationFlow) return;

    const chatId = message.from;
    const isGroupChat = chatId.endsWith('@g.us');

    if (!isGroupChat) {
      await proceedToNext(state, { outcome, studentAnswer, userId });
      return;
    }

    const replies = [message.reply.bind(message)];
    if (sendDirectMessage && userId) {
      replies.push((text) => sendDirectMessage(userId, text));
    }

    await explanationFlow.sendPersonalExplanation({
      replies,
      question,
      subject: state.subject,
      outcome,
      studentAnswer,
      userId,
    });
  }

  function clearExistingTimer(state) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  /**
   * The one new hook point. Every place that used to advance straight to the
   * next question now routes through here instead. With no explanationFlow
   * configured, behavior is unchanged from before. With one configured, the
   * question's timer stops immediately and the Explanation phase takes over
   * (see explanation/explanationFlow.js) until it calls `advance` itself.
   */
  async function proceedToNext(state, { outcome, studentAnswer, userId }) {
    clearExistingTimer(state);
    const question = state.questions[state.currentIndex];
    state.answeredQuestionIds.add(question.id);

    const advance = async () => {
      state.currentIndex += 1;
      await sendCurrentQuestion(state);
    };

    if (explanationFlow) {
      const explanationResult = await explanationFlow.enter({
        chatId: state.chatId,
        reply: state.reply,
        question,
        subject: state.subject,
        outcome,
        studentAnswer,
        userId: userId || state.userId,
        advance,
      });
      recordWrongReviewIfNeeded(state, {
        question,
        userId: userId || state.userId,
        studentAnswer,
        outcome,
        explanationResult,
      });
      return;
    }

    if (outcome === 'timeout') {
      await safeReply(state.reply, `Time is up. The answer was: ${question.answer}`);
    }

    recordWrongReviewIfNeeded(state, {
      question,
      userId: userId || state.userId,
      studentAnswer,
      outcome,
      explanationResult: null,
    });

    await advance();
  }

  return {
    startQuiz,
    handleAnswer,
    stopAll,
    stopQuiz,
  };
}

/**
 * Attempts a reply, retries once, and swallows the error if it still fails
 * (e.g. "Attempted to use detached Frame" from a Puppeteer/WhatsApp Web hiccup).
 * Never throws — callers can rely on this not blocking quiz progression.
 */
async function safeReply(replyFn, text) {
  try {
    await replyFn(text);
    return true;
  } catch (error) {
    logger.warn('First reply attempt failed, retrying once', error);
    try {
      await replyFn(text);
      return true;
    } catch (retryError) {
      logger.error('Reply failed after retry, continuing without it', retryError);
      return false;
    }
  }
}

function recordStudentAttempt(state, { userId, username, question, answerText, attemptNumber, isCorrect, timeTakenSeconds }) {
  if (!state.db && !state.userId && !userId) return;
  if (!state.db) return;

  try {
    state.db.upsertUser(userId, username);
    state.db.recordAttempt({
      userId,
      questionId: question.id,
      subject: state.subject,
      topic: state.topic || question.topic,
      attemptNumber,
      isCorrect,
      timeTakenSeconds,
    });
    state.db.updateStudyStreak(userId);
  } catch (error) {
    logger.error('Failed to record local quiz attempt', error);
  }
}

function recordWrongReviewIfNeeded(state, { question, userId, studentAnswer, outcome, explanationResult }) {
  if (!state.db || !userId) return;

  const wrongEntry = state.wrongAnswersByQuestion.get(question.id);
  if (!wrongEntry && outcome === 'correct') return;

  const answerForReview = wrongEntry?.studentAnswer || studentAnswer || null;
  if (outcome === 'correct' && !answerForReview) return;

  try {
    state.db.recordWrongAnswer({
      userId,
      question,
      subject: state.subject,
      topic: state.topic || question.topic,
      studentAnswer: answerForReview,
      explanation: explanationResult?.explanation || null,
      memoryTip: explanationResult?.memoryTip || null,
      createdAt: wrongEntry?.createdAt || new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to record wrong-answer review', error);
  }
}

function saveQuizSummary(state) {
  const completedAt = new Date();
  const totalQuestions = state.questions.length;
  const correctCount = state.correctQuestionIds.size;
  const percentage = totalQuestions ? (correctCount / totalQuestions) * 100 : 0;
  const timeTakenSeconds = Math.max(0, (completedAt.getTime() - state.startedAt.getTime()) / 1000);
  const previous = state.db && state.userId
    ? state.db.getPreviousSubjectSession(state.userId, state.subject, completedAt.toISOString())
    : null;
  const improvement = previous ? percentage - previous.percentage : null;
  const aiFeedback = buildFeedback({ percentage, improvement, subject: state.subject });
  let sessionId = null;
  let streak = { currentStreak: 0, longestStreak: 0 };
  let goal = { goalQuestions: 20, answered: 0, percentage: 0 };
  let unlockedBadges = [];

  if (state.db && state.userId) {
    try {
      sessionId = state.db.createQuizSession({
        userId: state.userId,
        chatId: state.chatId,
        subject: state.subject,
        topic: state.topic,
        totalQuestions,
        correctCount,
        percentage,
        timeTakenSeconds,
        aiFeedback,
        startedAt: state.startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      });
      streak = state.db.updateStudyStreak(state.userId);
      goal = state.db.getDailyGoalProgress(state.userId);
      unlockedBadges = unlockEarnedBadges(state.db, state.userId, { percentage, streak });
    } catch (error) {
      logger.error('Failed to save quiz summary', error);
    }
  }

  return {
    sessionId,
    subject: state.subject,
    topic: state.topic,
    totalQuestions,
    correctCount,
    percentage,
    timeTakenSeconds,
    aiFeedback,
    improvement,
    streak,
    goal,
    unlockedBadges,
    recommendation: buildRecommendation({ subject: state.subject, percentage, improvement }),
  };
}

function unlockEarnedBadges(db, userId, { percentage, streak }) {
  const stats = db.getPersonalStats(userId);
  const badges = [
    stats.totalQuizzes >= 1 ? ['first_quiz', 'First Quiz'] : null,
    streak.currentStreak >= 7 ? ['seven_day_streak', '7-Day Streak'] : null,
    stats.totalQuestions >= 500 ? ['five_hundred_questions', '500 Questions Answered'] : null,
    percentage >= 90 ? ['ninety_percent_score', '90% Score'] : null,
    stats.totalQuestions >= 1000 ? ['one_thousand_questions', '1000 Questions Completed'] : null,
  ].filter(Boolean);

  return badges
    .map(([key, name]) => db.unlockAchievement(userId, key, name))
    .filter(Boolean);
}

function buildFeedback({ percentage, improvement, subject }) {
  if (improvement !== null && improvement > 0) {
    return `Good progress. You improved by ${formatPercent(improvement)} since your last ${subject} quiz.`;
  }

  if (percentage >= 90) return 'Excellent work. You are showing strong exam readiness in this subject.';
  if (percentage >= 70) return 'Good work. Keep practising the questions you missed to push this into distinction range.';
  if (percentage >= 50) return 'You are building the foundation. Review the missed questions and try another short quiz soon.';
  return 'Do not worry. Focus on the explanations, revise the basics, and try again with a smaller topic.';
}

function buildRecommendation({ subject, percentage, improvement }) {
  if (percentage < 70) {
    return `Tomorrow, review your wrong answers and take another ${subject} quiz.`;
  }

  if (improvement !== null && improvement > 0) {
    return `Tomorrow, try a harder ${subject} quiz or choose a topic you usually avoid.`;
  }

  return `Tomorrow, take another ${subject} quiz to keep your study streak alive.`;
}

function formatQuizSummary(summary) {
  const lines = [
    '*Quiz Summary*',
    `Subject: ${capitalize(summary.subject)}`,
    summary.topic ? `Topic: ${summary.topic}` : null,
    `Score: ${summary.correctCount}/${summary.totalQuestions} (${formatPercent(summary.percentage)})`,
    `Time taken: ${formatDuration(summary.timeTakenSeconds)}`,
    '',
    summary.aiFeedback,
  ].filter((line) => line !== null);

  if (summary.improvement !== null) {
    const sign = summary.improvement >= 0 ? '+' : '';
    lines.push(`Improvement: ${sign}${formatPercent(summary.improvement)}`);
  }

  lines.push('');
  lines.push(`Study streak: ${summary.streak.currentStreak} day${summary.streak.currentStreak === 1 ? '' : 's'}`);
  lines.push(`Today's goal: ${summary.goal.answered}/${summary.goal.goalQuestions} questions (${formatPercent(summary.goal.percentage)} complete)`);

  if (summary.unlockedBadges.length) {
    lines.push('');
    lines.push(`New achievement${summary.unlockedBadges.length === 1 ? '' : 's'}: ${summary.unlockedBadges.map((badge) => badge.badgeName).join(', ')}`);
  }

  lines.push('');
  lines.push(summary.recommendation);
  lines.push('');
  lines.push('Send !review to revisit wrong answers or !stats to see your progress.');

  return lines.join('\n');
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function formatDuration(seconds) {
  const totalSeconds = Math.round(Number(seconds || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (!minutes) return `${remainder}s`;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

function isCorrectAnswer(answerText, question) {
  const acceptedAnswers = [question.answer, ...(question.acceptedAnswers || [])];
  return acceptedAnswers.some((answer) => normalizeAnswer(answerText) === normalizeAnswer(answer));
}

function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

module.exports = { createQuizService };
