const { getQuestions } = require('./questionService');
const { formatQuestion } = require('../utils/formatters');
const { logger } = require('../utils/logger');

function createQuizService({ sheetsService, timeLimitSeconds, pointsPerCorrectAnswer, maxAttemptsPerQuestion = 2, explanationFlow = null, sendDirectMessage = null, onQuizStarted = null }) {
  const activeQuizzes = new Map();

  async function startQuiz({ chatId, subject, topic, reply }) {
    if (activeQuizzes.has(chatId)) {
      return {
        started: false,
        message: 'A quiz is already running in this chat. Finish it before starting another one.',
      };
    }

    const questions = shuffle(await getQuestions({
      chatId,
      subject,
      topic,
      limit: 50,
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
      subject,
      topic,
      questions,
      currentIndex: 0,
      reply,
      timer: null,
      attemptsByUser: new Map(),
      scoredQuestionKeys: new Set(),
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

    await safeReply(reply, `Starting a ${questions.length}-question ${subject} quiz${topic ? ` on "${topic}"` : ''}. You have ${timeLimitSeconds} seconds per question.`);
    await sendCurrentQuestion(state);

    return { started: true };
  }

  async function handleAnswer({ message, answerText, username, userId }) {
    const chatId = message.from;
    const state = activeQuizzes.get(chatId);

    if (!state || !state.isActive) return;

    const question = state.questions[state.currentIndex];
    const userQuestionKey = `${userId}:${question.id}`;

    await sheetsService.recordAttendance({
      userId,
      username,
      subject: state.subject,
    });

    const attemptsUsed = state.attemptsByUser.get(userId) || 0;

    if (attemptsUsed >= maxAttemptsPerQuestion) {
      if (explanationFlow) {
        const handled = await explanationFlow.handlePersonalFollowUp({
          reply: message.reply.bind(message),
          question,
          subject: state.subject,
          userId,
          userMessage: answerText,
        });
        if (handled) return;
      }
      await safeReply(message.reply.bind(message), `${username}, you've used all ${maxAttemptsPerQuestion} attempts for this question. Wait for the next one.`);
      return;
    }

    const isCorrect = isCorrectAnswer(answerText, question);

    if (!isCorrect) {
      const newAttemptsUsed = attemptsUsed + 1;
      state.attemptsByUser.set(userId, newAttemptsUsed);
      const remaining = maxAttemptsPerQuestion - newAttemptsUsed;

      logger.info(`${username} answered ${question.id} incorrectly (attempt ${newAttemptsUsed}/${maxAttemptsPerQuestion})`);

      if (remaining > 0) {
        await safeReply(message.reply.bind(message), `Not quite, you are can do better, ${username}. You have ${remaining} attempt${remaining === 1 ? '' : 's'} left.`);
      } else {
        await safeReply(message.reply.bind(message), `Not quite, ${username}. You're out of attempts for this question.`);
        await deliverOutcomeExplanation(state, { message, question, outcome: 'wrong', studentAnswer: answerText, userId });
      }
      return;
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
    logger.info(`${username} scored ${pointsPerCorrectAnswer} points for ${question.id}`);
    await safeReply(message.reply.bind(message), `Correct, ${username}. +${pointsPerCorrectAnswer} points.`);

    await deliverOutcomeExplanation(state, { message, question, outcome: 'correct', studentAnswer: answerText, userId });
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
      await proceedToNext(state, { outcome: 'timeout', studentAnswer: null, userId: null });
    }, timeLimitSeconds * 1000);
  }

  async function finishQuiz(state) {
    clearExistingTimer(state);
    activeQuizzes.delete(state.chatId);
    state.isActive = false;
    logger.info(`Finished ${state.subject} quiz in chat ${state.chatId}`);
    await safeReply(state.reply, 'Quiz finished. Send -leaderboard to see the current ranking.');
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
      message: '⛔ Quiz stopped successfully. Send -leaderboard to see the current ranking. and take that quiz when your asses are free,you got that? 😎',
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

    const advance = async () => {
      state.currentIndex += 1;
      await sendCurrentQuestion(state);
    };

    if (explanationFlow) {
      await explanationFlow.enter({
        chatId: state.chatId,
        reply: state.reply,
        question,
        subject: state.subject,
        outcome,
        studentAnswer,
        userId,
        advance,
      });
      return;
    }

    if (outcome === 'timeout') {
      await safeReply(state.reply, `Time is up. The answer was: ${question.answer}`);
    }

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