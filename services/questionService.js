const fs = require('fs');
const path = require('path');
const { fetchJambQuestionsFromInternet } = require('./internetQuestionService');
const { getNextLocalBatch } = require('./localQuestionRotator');
const { logger } = require('../utils/logger');

const dataDirectory = path.join(__dirname, '..', 'data');
const supportedSubjects = [
  'english',
  'physics',
  'geography',
  'mathematics',
  'biology',
  'chemistry',
  'government',
  'CRS',
  'agricultural science',
  'literature',
  'maritime'
];
const subjectAliases = {
  math: 'mathematics',
  maths: 'mathematics',
  eng: 'english',
  bio: 'biology',
  boilogy: 'biology',
  chem: 'chemistry',
  phy: 'physics',
  geo: 'geography',
  gov: 'government',
  crs: 'CRS',
  agric: 'agricultural science',
  lit: 'literature',
  marit: 'maritime'
};
function getAvailableSubjects() {
  return supportedSubjects;
}

function normalizeSubject(subject) {
  if (!subject) return null;
  const normalized = subject.trim().toLowerCase();
  const aliased = subjectAliases[normalized] || normalized;
  return supportedSubjects.includes(aliased) ? aliased : null;
}

async function getQuestions({ chatId, subject, topic, limit = 50, sheetsService }) {
  const normalized = normalizeSubject(subject);

  if (!normalized) {
    throw new Error(`Unsupported subject: ${subject}`);
  }

  if (topic) {
    // Only worth checking Sheets/the internet when there's a specific topic
    // to search for — this is where that lookup actually adds value.
    const sheetQuestions = sheetsService
      ? await sheetsService.getQuestions({ subject: normalized, topic, limit })
      : [];

    const internetQuestions = await fetchJambQuestionsFromInternet({
      subject: normalized,
      topic,
      limit,
    });

    if (sheetQuestions.length || internetQuestions.length) {
      const localQuestions = sheetQuestions.length + internetQuestions.length < limit ? loadLocalQuestions(normalized) : [];
      const combined = dedupeByQuestion([...sheetQuestions, ...internetQuestions, ...localQuestions]).slice(0, limit);
      logger.info(`Using ${combined.length} questions for ${normalized}: ${topic}`);
      return combined;
    }

    logger.warn(`No internet questions found for ${normalized}: ${topic}. Falling back to local data.`);
  }

  // No topic given (the common !quiz <subject> case): skip the Sheets
  // round-trip entirely and go straight to the local question pool. The
  // Questions sheet isn't your source of truth — your local JSON files are
  // — so that call was pure wasted latency on every quiz start.
  //
  // Rotate through the local pool so repeated quiz starts for this
  // chat+subject cycle through fresh batches instead of always returning
  // the same first `limit` questions.
  const localPool = loadLocalQuestions(normalized);
  return getNextLocalBatch(chatId || 'default', normalized, localPool, limit);
}

function dedupeByQuestion(questions) {
  const seen = new Set();

  return questions.filter((question) => {
    const key = String(question.question || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadLocalQuestions(subject) {
  const normalized = normalizeSubject(subject);

  if (!normalized) {
    throw new Error(`Unsupported subject: ${subject}`);
  }

  const filePath = path.join(dataDirectory, `${normalized}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const questions = JSON.parse(raw);

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`No quiz questions found for ${normalized}`);
  }

  questions.forEach((question, index) => {
    if (!question.id || !question.question || !question.answer) {
      throw new Error(`Invalid question at ${normalized}.json index ${index}`);
    }
  });

  logger.info(`Loaded ${questions.length} ${normalized} questions`);
  return questions;
}

module.exports = {
  getAvailableSubjects,
  normalizeSubject,
  getQuestions,
  loadLocalQuestions,
};