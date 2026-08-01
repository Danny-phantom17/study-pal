function formatQuestion({ question, subject, questionNumber, totalQuestions, timeLimitSeconds }) {
  const header = [
    `📘 *${capitalize(subject)} Quiz*`,
    `*Question ${questionNumber}/${totalQuestions}*`,
    question.topic ? `_Topic: ${question.topic}_` : null,
    question.source ? `_Source: ${question.source}_` : null,
    `⏱️ _${timeLimitSeconds} seconds to answer_`,
  ].filter(Boolean);

  const blocks = [header.join('\n'), `*${question.question}*`];

  if (Array.isArray(question.options) && question.options.length) {
    const optionLines = question.options.map((option, index) => {
      const label = String.fromCharCode(65 + index);
      return `*${label}.* ${option}`;
    });
    blocks.push(optionLines.join('\n'));
  }

  return blocks.join('\n\n');
}

const OUTCOME_HEADERS = {
  correct: '✅ *Correct!*',
  wrong: '❌ *Not quite*',
  timeout: "⏰ *Time's up*",
};

/**
 * @param {object} params
 * @param {'correct'|'wrong'|'timeout'} params.outcome
 * @param {object} params.question
 * @param {string} params.explanation
 * @param {string} [params.memoryTip]
 */
function formatExplanation({ outcome, question, explanation, memoryTip }) {
  const blocks = [OUTCOME_HEADERS[outcome] || '*Explanation*'];

  if (outcome !== 'correct') {
    blocks.push(`*Correct answer:* ${question.answer}. ${optionText(question, question.answer)}`);
  }

  blocks.push(explanation);

  if (memoryTip) {
    blocks.push(`💡 _Memory tip: ${memoryTip}_`);
  }

  blocks.push(`_Reply *next* to continue, or ask a follow-up question._`);

  return blocks.join('\n\n');
}

/**
 * Personal, quiet version — sent privately to one user right after they
 * answer, WHILE the shared question timer keeps running for everyone else.
 * No "next"/follow-up prompt, since the group explanation phase handles that.
 */
function formatPersonalExplanation({ outcome, question, explanation, memoryTip }) {
  const blocks = [OUTCOME_HEADERS[outcome] || '*Explanation*'];

  blocks.push(explanation);

  if (memoryTip) {
    blocks.push(`💡 _Memory tip: ${memoryTip}_`);
  }

  return blocks.join('\n\n');
}

function optionText(question, letter) {
  if (!Array.isArray(question.options)) return '';
  const index = letter.charCodeAt(0) - 65;
  return question.options[index] || '';
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

module.exports = { formatQuestion, formatExplanation, formatPersonalExplanation };