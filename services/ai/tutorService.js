const { logger } = require('../../utils/logger');

const TUTOR_SYSTEM_PROMPT = `You are a patient, encouraging tutor for Nigerian WAEC and JAMB exam students. Explain concepts simply and clearly, the way a good teacher would for a teenager preparing for these exams. Keep explanations concise unless asked for more detail.

Respond ONLY with a JSON object of this exact shape, and nothing else — no markdown code fences, no preamble, no extra text:
{"explanation": "...", "memoryTip": "..."}

"explanation" must say why the correct answer is correct and why each wrong option is wrong. Use short labels like "A:", "B:", "C:", and "D:" when options are present.
"memoryTip" should be a short mnemonic or memory trick if one genuinely helps for this topic, or an empty string "" if none is useful. Never invent a forced or unhelpful mnemonic just to fill the field.`;

const FOLLOWUP_SYSTEM_PROMPT = `You are a patient, encouraging tutor for Nigerian WAEC and JAMB exam students, continuing a conversation about a quiz question. Keep responses concise (2-4 sentences) and in simple language suitable for a teenager preparing for these exams. Respond with plain text only, no JSON, no markdown formatting.`;
const GENERAL_TUTOR_SYSTEM_PROMPT = `You are StudyPal, a warm personal AI tutor for Nigerian WAEC and JAMB students. Give clear, practical study help in plain text. Keep answers concise by default, explain like a good teacher, and encourage the student to practise privately with quiz commands when useful.`;

const MAX_FOLLOWUPS_PER_QUESTION = 5;

/**
 * @param {object} deps
 * @param {{ generateCompletion: Function }} deps.aiProvider
 * @param {ReturnType<import('../../db/db').createDb>} deps.db
 */
function createTutorService({ aiProvider, db }) {
  async function getExplanation({ question, subject, outcome, studentAnswer }) {
    const cached = db.getCachedExplanation(question.id);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const userPrompt = buildExplanationPrompt({ question, subject, outcome, studentAnswer });

    let parsed;
    try {
      const raw = await aiProvider.generateCompletion({
        systemPrompt: TUTOR_SYSTEM_PROMPT,
        userPrompt,
      });
      parsed = parseExplanationResponse(raw);
    } catch (error) {
      // AI failed or returned something unparsable — degrade gracefully
      // rather than breaking the quiz flow, but log the real reason so
      // it doesn't disappear silently.
      logger.error(`getExplanation failed for question ${question.id}`, error);
      parsed = {
        explanation: `The correct answer is ${question.answer}. (Explanation temporarily unavailable — try "explain more" in a moment.)`,
        memoryTip: '',
      };
    }

    db.saveExplanation(question.id, parsed.explanation, parsed.memoryTip);
    return { ...parsed, fromCache: false };
  }

  async function handleFollowUp({ userId, chatId, question, subject, userMessage, followUpCount, ignoreLimit = false }) {
    if (!ignoreLimit && followUpCount >= MAX_FOLLOWUPS_PER_QUESTION) {
      return {
        reply: "Let's keep moving — you can ask more questions once we get to the next one!",
        limited: true,
      };
    }

    db.recordConversationTurn({ userId, chatId, role: 'user', message: userMessage });
    const history = db.getRecentConversation(chatId, 6);

    const contextLines = history.map((turn) => `${turn.role}: ${turn.message}`).join('\n');
    const userPrompt = `Question: ${question.question}\nCorrect answer: ${question.answer}\nSubject: ${subject}\n\nConversation so far:\n${contextLines}\n\nRespond to the student's latest message.`;

    let reply;
    try {
      reply = await aiProvider.generateCompletion({
        systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
        userPrompt,
      });
    } catch (error) {
      logger.error('handleFollowUp failed', error);
      reply = "Sorry, I couldn't process that just now — try again in a moment, or send 'next' to continue.";
    }

    db.recordConversationTurn({ userId, chatId, role: 'assistant', message: reply });
    return { reply, limited: false };
  }

  async function handleGeneralChat({ userId, chatId, userMessage }) {
    db.recordConversationTurn({ userId, chatId, role: 'user', message: userMessage });
    const history = db.getRecentConversation(chatId, 8);
    const contextLines = history.map((turn) => `${turn.role}: ${turn.message}`).join('\n');
    const userPrompt = `Conversation so far:\n${contextLines}\n\nRespond to the student's latest message.`;

    let reply;
    try {
      reply = await aiProvider.generateCompletion({
        systemPrompt: GENERAL_TUTOR_SYSTEM_PROMPT,
        userPrompt,
      });
    } catch (error) {
      logger.error('handleGeneralChat failed', error);
      reply = 'I could not reach the AI tutor just now. Try again in a moment, or send !quiz biology to practise.';
    }

    db.recordConversationTurn({ userId, chatId, role: 'assistant', message: reply });
    return reply;
  }

  return { getExplanation, handleFollowUp, handleGeneralChat };
}

function buildExplanationPrompt({ question, subject, outcome, studentAnswer }) {
  const optionsList = Array.isArray(question.options)
    ? question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')
    : '';

  const outcomeContext = {
    correct: 'The student answered this correctly.',
    wrong: `The student answered incorrectly (they chose "${studentAnswer}"). Briefly explain why their answer is wrong as well as why the correct one is right.`,
    timeout: 'The student ran out of time and did not answer.',
  }[outcome] || '';

  return `Subject: ${subject}\nQuestion: ${question.question}\nOptions:\n${optionsList}\nCorrect answer: ${question.answer}\n\n${outcomeContext}\n\nExplain why the correct option is right and why every wrong option is wrong, in simple language for a WAEC/JAMB student.`;
}

function parseExplanationResponse(raw) {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) {
    throw new Error('AI response missing explanation text.');
  }

  return {
    explanation: parsed.explanation.trim(),
    memoryTip: typeof parsed.memoryTip === 'string' ? parsed.memoryTip.trim() : '',
  };
}

module.exports = { createTutorService, MAX_FOLLOWUPS_PER_QUESTION };
