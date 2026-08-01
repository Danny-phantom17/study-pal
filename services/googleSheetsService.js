const { google } = require('googleapis');
const { nowIsoDate, nowIsoDateTime } = require('../utils/date');
const { logger } = require('../utils/logger');

const SHEETS = {
  scores: 'Scores',
  attendance: 'Attendance',
  questions: 'Questions',
};

const HEADERS = {
  scores: ['Timestamp', 'Date', 'User ID', 'Username', 'Subject', 'Question ID', 'Points'],
  attendance: ['Timestamp', 'Date', 'User ID', 'Username', 'Subject'],
  questions: [
    'Subject',
    'Topic',
    'Question ID',
    'Question',
    'Option A',
    'Option B',
    'Option C',
    'Option D',
    'Answer',
    'Accepted Answers',
  ],
};

function createGoogleSheetsService() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL;
  let sheets;
  let mode = 'disabled';
  let enabled = true;

  async function initialize() {
    if (appsScriptUrl) {
      mode = 'apps-script';
      enabled = true;
      await postToAppsScript({ action: 'setup' });
      logger.info('Google Sheets Apps Script service initialized.');
      return;
    }

    if (!spreadsheetId || !process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      enabled = false;
      mode = 'disabled';
      logger.warn('Google Sheets is not configured. The bot will run, but data will not be saved.');
      return;
    }

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    mode = 'service-account';
    await ensureSheet(SHEETS.scores, HEADERS.scores);
    await ensureSheet(SHEETS.attendance, HEADERS.attendance);
    await ensureSheet(SHEETS.questions, HEADERS.questions);
    logger.info('Google Sheets service initialized.');
  }

  async function recordScore({ userId, username, subject, questionId, points }) {
    if (!enabled) return { saved: true, duplicate: false };

    if (mode === 'apps-script') {
      const result = await postToAppsScript({
        action: 'recordScore',
        timestamp: nowIsoDateTime(),
        date: nowIsoDate(),
        userId,
        username,
        subject,
        questionId,
        points,
      });

      return {
        saved: Boolean(result.saved),
        duplicate: Boolean(result.duplicate),
      };
    }

    const alreadyScored = await hasExistingScore({ userId, questionId });
    if (alreadyScored) {
      logger.warn(`Skipped duplicate score for user ${userId} and question ${questionId}`);
      return { saved: false, duplicate: true };
    }

    await appendRow(SHEETS.scores, [
      nowIsoDateTime(),
      nowIsoDate(),
      userId,
      username,
      subject,
      questionId,
      points,
    ]);

    return { saved: true, duplicate: false };
  }

  async function recordAttendance({ userId, username, subject }) {
    if (!enabled) return;

    if (mode === 'apps-script') {
      await postToAppsScript({
        action: 'recordAttendance',
        timestamp: nowIsoDateTime(),
        date: nowIsoDate(),
        userId,
        username,
        subject,
      });
      return;
    }

    await appendRow(SHEETS.attendance, [
      nowIsoDateTime(),
      nowIsoDate(),
      userId,
      username,
      subject,
    ]);
  }

  async function getLeaderboard() {
    if (!enabled) return [];

    if (mode === 'apps-script') {
      const result = await getFromAppsScript({ action: 'leaderboard' });
      return result.leaderboard || [];
    }

    const rows = await readRows(`${SHEETS.scores}!A2:G`);
    const totals = new Map();

    rows.forEach((row) => {
      const userId = row[2];
      const username = row[3] || 'Unknown user';
      const points = Number(row[6] || 0);

      if (!userId) return;

      const current = totals.get(userId) || { userId, username, points: 0 };
      current.username = username;
      current.points += points;
      totals.set(userId, current);
    });

    return [...totals.values()].sort((a, b) => b.points - a.points);
  }

  async function getUserScore(userId) {
    const leaderboard = await getLeaderboard();
    const entry = leaderboard.find((item) => item.userId === userId);
    return entry ? entry.points : 0;
  }

  async function getRecentAttendance(limit = 10) {
    if (!enabled) return [];

    if (mode === 'apps-script') {
      const result = await getFromAppsScript({ action: 'attendance', limit });
      return result.attendance || [];
    }

    const rows = await readRows(`${SHEETS.attendance}!A2:E`);
    return rows
      .slice(-limit)
      .reverse()
      .map((row) => ({
        timestamp: row[0],
        date: row[1],
        userId: row[2],
        username: row[3] || 'Unknown user',
        subject: row[4] || 'unknown subject',
      }));
  }

  async function getQuestions({ subject, topic, limit = 50 }) {
    if (!enabled) return [];

    if (mode === 'apps-script') {
      const result = await getFromAppsScript({
        action: 'questions',
        subject,
        topic,
        limit,
      });

      return result.questions || [];
    }

    const rows = await readRows(`${SHEETS.questions}!A2:J`);
    const normalizedSubject = normalizeCell(subject);
    const normalizedTopic = normalizeCell(topic);

    return rows
      .map((row, index) => rowToQuestion(row, index))
      .filter(Boolean)
      .filter((question) => {
        const subjectMatches = normalizeCell(question.subject) === normalizedSubject;
        const topicMatches = !normalizedTopic || normalizeCell(question.topic).includes(normalizedTopic);
        return subjectMatches && topicMatches;
      })
      .slice(0, limit);
  }

  async function hasExistingScore({ userId, questionId }) {
    const rows = await readRows(`${SHEETS.scores}!A2:G`);
    return rows.some((row) => row[2] === userId && row[5] === questionId);
  }

  async function appendRow(sheetName, row) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:Z`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row],
        },
      });
    } catch (error) {
      logger.error(`Failed to append row to ${sheetName}`, error);
      throw error;
    }
  }

  async function readRows(range) {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });
      return response.data.values || [];
    } catch (error) {
      logger.error(`Failed to read range ${range}`, error);
      throw error;
    }
  }

  async function ensureSheet(sheetName, headers) {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = spreadsheet.data.sheets.find((sheet) => sheet.properties.title === sheetName);

    if (!existingSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: sheetName },
              },
            },
          ],
        },
      });
      logger.info(`Created Google Sheet tab: ${sheetName}`);
    }

    const headerRows = await readRows(`${sheetName}!A1:Z1`);
    if (!headerRows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [headers],
        },
      });
      logger.info(`Added headers to ${sheetName}`);
    }
  }

  async function postToAppsScript(payload) {
    return requestAppsScript({
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
    });
  }

  async function getFromAppsScript(params) {
    const url = new URL(appsScriptUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    return requestAppsScript({ url });
  }

  async function requestAppsScript(options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(options.url || appsScriptUrl, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Apps Script returned HTTP ${response.status}: ${text.slice(0, 120)}`);
      }

      const result = JSON.parse(text);
      if (result.ok === false) {
        throw new Error(result.error || 'Apps Script request failed');
      }

      return result;
    } catch (error) {
      logger.error('Apps Script request failed', error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    initialize,
    recordScore,
    recordAttendance,
    getLeaderboard,
    getUserScore,
    getRecentAttendance,
    getQuestions,
  };
}

function rowToQuestion(row, index) {
  const subject = row[0];
  const topic = row[1] || '';
  const question = row[3];
  const options = [row[4], row[5], row[6], row[7]].filter(Boolean);
  const answer = normalizeAnswer(row[8], options);

  if (!subject || !question || options.length < 2 || !answer) return null;

  return {
    id: row[2] || `sheet-${normalizeCell(subject)}-${normalizeCell(topic)}-${index + 2}`,
    subject: normalizeCell(subject),
    topic,
    source: 'Google Sheets',
    question,
    options,
    answer,
    acceptedAnswers: parseAcceptedAnswers(row[9], answer, options),
  };
}

function parseAcceptedAnswers(value, answer, options) {
  const extraAnswers = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const answerIndex = answer.charCodeAt(0) - 65;
  if (options[answerIndex]) {
    extraAnswers.push(options[answerIndex]);
  }

  return [...new Set(extraAnswers)];
}

function normalizeAnswer(answer, options) {
  const raw = String(answer || '').trim();
  const letterMatch = raw.match(/^[A-D]$/i);

  if (letterMatch) {
    return letterMatch[0].toUpperCase();
  }

  const optionIndex = options.findIndex((option) => normalizeCell(option) === normalizeCell(raw));
  if (optionIndex >= 0) {
    return String.fromCharCode(65 + optionIndex);
  }

  return null;
}

function normalizeCell(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = { createGoogleSheetsService };
