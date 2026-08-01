const SPREADSHEET_ID = '1MEuGK0YOXd7yGurmHzKqFxooM_jGvkIlVPfal9RX-0U';

const SHEETS = {
  scores: 'Scores',
  attendance: 'Attendance',
  questions: 'Questions',
};

const HEADERS = {
  Scores: ['Timestamp', 'Date', 'User ID', 'Username', 'Subject', 'Question ID', 'Points'],
  Attendance: ['Timestamp', 'Date', 'User ID', 'Username', 'Subject'],
  Questions: [
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

function doPost(e) {
  try {
    ensureSheets();
    const data = JSON.parse(e.postData.contents || '{}');

    if (data.action === 'recordScore') {
      return json(recordScore(data));
    }

    if (data.action === 'recordAttendance') {
      recordAttendance(data);
      return json({ ok: true });
    }

    if (data.action === 'setup') {
      return json({ ok: true, sheets: Object.values(SHEETS) });
    }

    return json({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return json({ ok: false, error: error.message });
  }
}

function doGet(e) {
  try {
    ensureSheets();
    const action = e.parameter.action;

    if (action === 'leaderboard') {
      return json({ ok: true, leaderboard: getLeaderboard() });
    }

    if (action === 'score') {
      return json({ ok: true, score: getUserScore(e.parameter.userId) });
    }

    if (action === 'attendance') {
      return json({ ok: true, attendance: getRecentAttendance(Number(e.parameter.limit || 10)) });
    }

    if (action === 'questions') {
      return json({
        ok: true,
        questions: getQuestions({
          subject: e.parameter.subject,
          topic: e.parameter.topic,
          limit: Number(e.parameter.limit || 50),
        }),
      });
    }

    return json({ ok: true, message: 'Study bot Apps Script is online' });
  } catch (error) {
    return json({ ok: false, error: error.message });
  }
}

function recordScore(data) {
  const sheet = getSheet(SHEETS.scores);
  const rows = sheet.getDataRange().getValues();
  const duplicate = rows.slice(1).some(function (row) {
    return String(row[2]) === String(data.userId) && String(row[5]) === String(data.questionId);
  });

  if (duplicate) {
    return { ok: true, saved: false, duplicate: true };
  }

  sheet.appendRow([
    data.timestamp,
    data.date,
    data.userId,
    data.username,
    data.subject,
    data.questionId,
    Number(data.points || 0),
  ]);

  return { ok: true, saved: true, duplicate: false };
}

function recordAttendance(data) {
  getSheet(SHEETS.attendance).appendRow([
    data.timestamp,
    data.date,
    data.userId,
    data.username,
    data.subject,
  ]);
}

function getLeaderboard() {
  const rows = getSheet(SHEETS.scores).getDataRange().getValues().slice(1);
  const totals = {};

  rows.forEach(function (row) {
    const userId = String(row[2] || '');
    if (!userId) return;

    totals[userId] = totals[userId] || {
      userId: userId,
      username: row[3] || 'Unknown user',
      points: 0,
    };

    totals[userId].username = row[3] || totals[userId].username;
    totals[userId].points += Number(row[6] || 0);
  });

  return Object.keys(totals)
    .map(function (userId) {
      return totals[userId];
    })
    .sort(function (a, b) {
      return b.points - a.points;
    });
}

function getUserScore(userId) {
  const entry = getLeaderboard().find(function (item) {
    return String(item.userId) === String(userId);
  });

  return entry ? entry.points : 0;
}

function getRecentAttendance(limit) {
  const rows = getSheet(SHEETS.attendance).getDataRange().getValues().slice(1);

  return rows
    .slice(-limit)
    .reverse()
    .map(function (row) {
      return {
        timestamp: row[0],
        date: row[1],
        userId: row[2],
        username: row[3] || 'Unknown user',
        subject: row[4] || 'unknown subject',
      };
    });
}

function getQuestions(filter) {
  const subject = normalize(filter.subject);
  const topic = normalize(filter.topic);
  const rows = getSheet(SHEETS.questions).getDataRange().getValues().slice(1);

  return rows
    .map(rowToQuestion)
    .filter(Boolean)
    .filter(function (question) {
      const subjectMatches = normalize(question.subject) === subject;
      const topicMatches = !topic || normalize(question.topic).indexOf(topic) !== -1;
      return subjectMatches && topicMatches;
    })
    .slice(0, filter.limit || 50);
}

function rowToQuestion(row, index) {
  const options = [row[4], row[5], row[6], row[7]].filter(Boolean);
  const answer = normalizeAnswer(row[8], options);

  if (!row[0] || !row[3] || options.length < 2 || !answer) return null;

  return {
    subject: normalize(row[0]),
    topic: row[1] || '',
    id: row[2] || 'sheet-' + normalize(row[0]) + '-' + normalize(row[1]) + '-' + index,
    question: row[3],
    options: options,
    answer: answer,
    acceptedAnswers: parseAcceptedAnswers(row[9], answer, options),
    source: 'Google Sheets',
  };
}

function ensureSheets() {
  Object.values(SHEETS).forEach(function (sheetName) {
    const sheet = getSheet(sheetName);
    const headers = HEADERS[sheetName];
    const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const hasHeaders = firstRow.some(function (cell) {
      return String(cell || '').trim();
    });

    if (!hasHeaders) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });
}

function getSheet(sheetName) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function parseAcceptedAnswers(value, answer, options) {
  const items = String(value || '')
    .split(',')
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);

  const answerIndex = answer.charCodeAt(0) - 65;
  if (options[answerIndex]) items.push(options[answerIndex]);

  return Array.from(new Set(items));
}

function normalizeAnswer(answer, options) {
  const raw = String(answer || '').trim();
  if (/^[A-D]$/i.test(raw)) return raw.toUpperCase();

  const optionIndex = options.findIndex(function (option) {
    return normalize(option) === normalize(raw);
  });

  return optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : null;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
