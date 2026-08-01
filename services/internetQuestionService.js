const { google } = require('googleapis');
const { logger } = require('../utils/logger');

const MAX_SEARCH_RESULTS = 10;
const REQUEST_TIMEOUT_MS = 12000;

async function fetchJambQuestionsFromInternet({ subject, topic, limit }) {
  const fromCustomProvider = await fetchFromCustomProvider({ subject, topic, limit });
  if (fromCustomProvider.length) return fromCustomProvider;

  return fetchFromGoogleSearch({ subject, topic, limit });
}

async function fetchFromCustomProvider({ subject, topic, limit }) {
  const apiUrl = process.env.JAMB_QUESTION_API_URL;
  if (!apiUrl) return [];

  try {
    const url = new URL(apiUrl);
    url.searchParams.set('subject', subject);
    url.searchParams.set('topic', topic);
    url.searchParams.set('limit', String(limit));

    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Question API returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    return normalizeQuestionList(payload.questions || payload, { subject, topic, source: 'JAMB API' }).slice(0, limit);
  } catch (error) {
    logger.error('Failed to fetch questions from custom JAMB provider', error);
    return [];
  }
}

async function fetchFromGoogleSearch({ subject, topic, limit }) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    logger.warn('Internet question lookup is not configured. Set JAMB_QUESTION_API_URL or Google Search API variables.');
    return [];
  }

  try {
    const customsearch = google.customsearch('v1');
    const searchResponse = await customsearch.cse.list({
      auth: apiKey,
      cx: searchEngineId,
      num: MAX_SEARCH_RESULTS,
      q: `JAMB past questions ${subject} ${topic} objective questions answers`,
      safe: 'active',
    });

    const urls = (searchResponse.data.items || [])
      .map((item) => item.link)
      .filter(Boolean);

    const collected = [];
    for (const url of urls) {
      if (collected.length >= limit) break;

      const questions = await scrapeQuestionsFromPage({
        url,
        subject,
        topic,
      });

      collected.push(...questions);
    }

    return dedupeQuestions(collected).slice(0, limit);
  } catch (error) {
    logger.error('Failed to fetch questions with Google Search', error);
    return [];
  }
}

async function scrapeQuestionsFromPage({ url, subject, topic }) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 StudyGroupBot/1.0',
      },
    });

    if (!response.ok) {
      logger.warn(`Skipped ${url}: HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    const text = htmlToPlainText(html);
    const questions = extractQuestionsFromText(text, { subject, topic, source: new URL(url).hostname });

    logger.info(`Extracted ${questions.length} questions from ${url}`);
    return questions;
  } catch (error) {
    logger.warn(`Failed to scrape questions from ${url}`, error.message);
    return [];
  }
}

function extractQuestionsFromText(text, { subject, topic, source }) {
  const normalizedText = text
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const blocks = normalizedText.split(/\n(?=(?:Question\s*)?\d{1,3}[\).:-]\s+)/i);

  return blocks
    .map((block, index) => parseQuestionBlock(block, { subject, topic, source, index }))
    .filter(Boolean);
}

function parseQuestionBlock(block, { subject, topic, source, index }) {
  const cleaned = block.replace(/\s+/g, ' ').trim();
  const optionMatches = [...cleaned.matchAll(/\b([A-D])[\).:-]\s*(.*?)(?=\s+\b[A-D][\).:-]\s*|\s+(?:Answer|Ans|Correct Answer)\b|$)/gi)];

  if (optionMatches.length < 2) return null;

  const firstOptionIndex = optionMatches[0].index;
  const questionText = cleaned
    .slice(0, firstOptionIndex)
    .replace(/^(?:Question\s*)?\d{1,3}[\).:-]\s*/i, '')
    .trim();

  if (!questionText || questionText.length < 10) return null;

  const options = optionMatches.slice(0, 4).map((match) => match[2].trim());
  const answerMatch = cleaned.match(/\b(?:Answer|Ans|Correct Answer)\s*[:=-]?\s*([A-D]|\w[\w\s'-]{1,80})/i);

  if (!answerMatch) return null;

  const answer = normalizeAnswerLetter(answerMatch[1], options);
  if (!answer) return null;

  return {
    id: buildQuestionId({ subject, topic, question: questionText, fallbackIndex: index }),
    subject,
    topic,
    source,
    question: questionText,
    options,
    answer,
    acceptedAnswers: buildAcceptedAnswers(answer, options),
  };
}

function normalizeQuestionList(items, { subject, topic, source }) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => {
      const options = item.options || [item.optionA, item.optionB, item.optionC, item.optionD].filter(Boolean);
      const answer = normalizeAnswerLetter(item.answer || item.correctAnswer || item.correct_option, options);

      if (!item.question || options.length < 2 || !answer) return null;

      return {
        id: item.id || buildQuestionId({ subject, topic, question: item.question, fallbackIndex: index }),
        subject,
        topic: item.topic || topic,
        source: item.source || source,
        question: item.question,
        options,
        answer,
        acceptedAnswers: item.acceptedAnswers || buildAcceptedAnswers(answer, options),
      };
    })
    .filter(Boolean);
}

function normalizeAnswerLetter(answer, options) {
  const raw = String(answer || '').trim();
  const letterMatch = raw.match(/(?:^|\b)(?:option\s*)?([A-D])(?:\b|[\).:-])/i);
  if (letterMatch) return letterMatch[1].toUpperCase();

  const optionIndex = options.findIndex((option) => normalizeText(option) === normalizeText(raw));
  if (optionIndex >= 0) return String.fromCharCode(65 + optionIndex);

  return null;
}

function buildAcceptedAnswers(answer, options) {
  const optionIndex = answer.charCodeAt(0) - 65;
  const optionText = options[optionIndex];
  return optionText ? [optionText] : [];
}

function dedupeQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const key = normalizeText(question.question);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function htmlToPlainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n');
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildQuestionId({ subject, topic, question, fallbackIndex }) {
  const questionSlug = slugify(question).slice(0, 80);
  return questionSlug
    ? `jamb-${subject}-${slugify(topic)}-${questionSlug}`
    : `jamb-${subject}-${slugify(topic)}-${fallbackIndex}`;
}

module.exports = { fetchJambQuestionsFromInternet };
