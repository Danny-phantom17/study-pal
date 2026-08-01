const { formatExplanation, formatPersonalExplanation } = require('../utils/formatters');
const { logger } = require('../utils/logger');

const DEFAULT_AUTO_ADVANCE_MS = {
  correct: 8000,
  wrong: 10000,
  timeout: 10000,
};

/**
 * @param {object} deps
 * @param {ReturnType<import('../services/ai/tutorService').createTutorService>} deps.tutorService
 * @param {ReturnType<import('../state/conversationStateStore').createConversationStateStore>} deps.stateStore
 * @param {object} deps.logger
 * @param {object} [deps.autoAdvanceMs] - override default timings, e.g. for tests
 */
function createExplanationFlow({ tutorService, stateStore, logger, autoAdvanceMs = {} }) {
  const timings = { ...DEFAULT_AUTO_ADVANCE_MS, ...autoAdvanceMs };
  const activeExplanations = new Map(); // chatId -> { advance, timer, question, subject, followUpCount, userId }

  /**
   * Called by quizService at the three outcome points (correct / wrong-out-of-attempts / timeout)
   * instead of advancing straight to the next question.
   *
   * @param {object} params
   * @param {string} params.chatId
   * @param {Function} params.reply - the same reply function quizService already has
   * @param {object} params.question - the question that was just answered
   * @param {string} params.subject
   * @param {'correct'|'wrong'|'timeout'} params.outcome
   * @param {string} [params.studentAnswer]
   * @param {string} [params.userId] - for follow-up conversation logging
   * @param {Function} params.advance - callback that resumes the quiz engine's normal flow
   */
  async function enter({ chatId, reply, question, subject, outcome, studentAnswer, userId, advance }) {
    stateStore.setPhase(chatId, 'explanation');

    const { explanation, memoryTip } = await tutorService.getExplanation({
      question,
      subject,
      outcome,
      studentAnswer,
    });

    await safeReply(reply, formatExplanation({ outcome, question, explanation, memoryTip }));

    const entry = {
      advance,
      question,
      subject,
      userId,
      followUpCount: 0,
      timer: null,
    };

    entry.timer = setTimeout(() => {
      logger.info(`Explanation phase auto-advancing for chat ${chatId}`);
      moveOn(chatId);
    }, timings[outcome] || timings.wrong);

    activeExplanations.set(chatId, entry);
  }

  /**
   * Called by your message router (index.js) whenever a message arrives
   * while stateStore.getPhase(chatId) === 'explanation'.
   *
   * @returns {boolean} true if this flow handled the message, false if the
   *   caller should do something else with it (e.g. no active explanation).
   */
  async function handleMessage({ chatId, text, reply, userId }) {
    const entry = activeExplanations.get(chatId);
    if (!entry) return false;

    const trimmed = String(text || '').trim().toLowerCase();

    if (trimmed === 'next') {
      moveOn(chatId);
      return true;
    }

    // Anything else while in the explanation phase is treated as a
    // follow-up question to the tutor ("explain more", "simplify",
    // free-form questions about the topic).
    entry.followUpCount += 1;
    const { reply: followUpReply, limited } = await tutorService.handleFollowUp({
      userId: userId || entry.userId,
      chatId,
      question: entry.question,
      subject: entry.subject,
      userMessage: text,
      followUpCount: entry.followUpCount,
    });

    await safeReply(reply, followUpReply);

    if (limited) {
      moveOn(chatId);
    }

    return true;
  }

  function moveOn(chatId) {
    const entry = activeExplanations.get(chatId);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    activeExplanations.delete(chatId);
    stateStore.setPhase(chatId, 'quiz');

    entry.advance().catch((error) => {
      logger.error('Failed to advance quiz after explanation phase', error);
    });
  }

  /**
   * Cancels an in-progress explanation phase WITHOUT calling `advance`.
   * Used when the quiz itself is being stopped (e.g. !stop) so the queued
   * "move to the next question" callback never fires and the chat's phase
   * doesn't get silently left as 'explanation' after the quiz is gone.
   *
   * Unlike moveOn(), this does not touch stateStore's phase — the caller
   * (quizService.stopQuiz) is expected to own that decision, since it also
   * knows about resetting other quiz-level state.
   *
   * @param {string} chatId
   * @returns {boolean} true if there was an active explanation to cancel
   */
  function cancel(chatId) {
    const entry = activeExplanations.get(chatId);
    if (!entry) return false;

    if (entry.timer) clearTimeout(entry.timer);
    activeExplanations.delete(chatId);

    return true;
  }

  /**
   * Sends a quiet, personal explanation — does NOT touch the shared question
   * timer, does NOT change the chat's phase, does NOT advance the quiz.
   * Everyone else keeps answering normally. Accepts one or more reply
   * functions (e.g. a group reply AND a DM) so multi-destination sends only
   * cost one cache/AI lookup, not one per destination.
   */
  async function sendPersonalExplanation({ replies, question, subject, outcome, studentAnswer }) {
    const { explanation, memoryTip } = await tutorService.getExplanation({
      question,
      subject,
      outcome,
      studentAnswer,
    });

    const text = formatPersonalExplanation({ outcome, question, explanation, memoryTip });
    const replyFns = Array.isArray(replies) ? replies : [replies];

    await Promise.all(replyFns.filter(Boolean).map((fn) => safeReply(fn, text)));
  }

  /**
   * Handles a follow-up message from a user who's already done with the
   * current question (correct, or out of attempts) but the quiz is still
   * running live for everyone else — no phase change, no shared timer
   * interaction, just a direct tutor reply. Always returns true (handled)
   * since tutorService.handleFollowUp degrades gracefully on its own.
   */
  async function handlePersonalFollowUp({ reply, question, subject, userId, userMessage }) {
    const { reply: followUpReply } = await tutorService.handleFollowUp({
      userId,
      chatId: `${userId}:personal`, // separate conversation thread from the shared explanation phase
      question,
      subject,
      userMessage,
      followUpCount: 0, // personal follow-ups aren't capped the same way — the question's own lifetime bounds this
    });

    await safeReply(reply, followUpReply);
    return true;
  }

  return { enter, handleMessage, sendPersonalExplanation, handlePersonalFollowUp, cancel };
}

/**
 * Attempts a reply, retries once, and swallows the error if it still fails
 * (e.g. "Attempted to use detached Frame" from a Puppeteer/WhatsApp Web hiccup).
 * Never throws — callers can rely on this not crashing the bot.
 * Mirrors the same helper in services/quizService.js.
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

module.exports = { createExplanationFlow };