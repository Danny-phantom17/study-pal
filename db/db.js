const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Creates (or opens) the StudyPal SQLite database and applies the schema.
 * Safe to call on every startup — CREATE TABLE IF NOT EXISTS throughout.
 *
 * Uses Node's built-in node:sqlite (available since Node 22.5+, no native
 * compilation needed) instead of better-sqlite3 — avoids requiring Visual
 * Studio Build Tools on Windows or build-essential on Linux just to install
 * a database driver.
 *
 * @param {string} dbPath - file path for the SQLite database, e.g. './data/studypal.db'
 */
function createDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  // WAL mode lets reads happen without waiting on writes, and NORMAL sync
  // (instead of the default FULL) skips an extra disk flush per write —
  // both meaningfully cut down how long each database call blocks the
  // event loop, since DatabaseSync is synchronous.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  // --- Explanation cache (the cost-saving piece) ---

  function getCachedExplanation(questionId) {
    const row = db
      .prepare('SELECT explanation_text, memory_tip FROM explanation_cache WHERE question_id = ?')
      .get(questionId);

    if (!row) return null;

    return {
      explanation: row.explanation_text,
      memoryTip: row.memory_tip || '',
    };
  }

  function saveExplanation(questionId, explanation, memoryTip) {
    db.prepare(
      `INSERT INTO explanation_cache (question_id, explanation_text, memory_tip, generated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET
         explanation_text = excluded.explanation_text,
         memory_tip = excluded.memory_tip,
         generated_at = excluded.generated_at`
    ).run(questionId, explanation, memoryTip || '', new Date().toISOString());
  }

  // --- Users ---

  function upsertUser(userId, username) {
    db.prepare(
      `INSERT INTO users (user_id, username, first_seen)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         username = COALESCE(excluded.username, users.username)`
    ).run(userId, username || null, new Date().toISOString());
  }

  // --- Attempts ---

  function recordAttempt({ userId, questionId, subject, topic, attemptNumber, isCorrect, timeTakenSeconds }) {
    db.prepare(
      `INSERT INTO attempts (user_id, question_id, subject, topic, attempt_number, is_correct, time_taken_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      questionId,
      subject,
      topic || null,
      attemptNumber,
      isCorrect ? 1 : 0,
      timeTakenSeconds || null,
      new Date().toISOString()
    );
  }

  // --- AI conversation history ---

  function recordConversationTurn({ userId, chatId, role, message }) {
    // ai_conversations.user_id has a foreign key to users.user_id, but
    // nothing else in the app currently creates that row — upsertUser was
    // defined but never called. Ensure the user exists first so this insert
    // doesn't fail with a foreign key constraint error. Passing a null
    // username here is safe: COALESCE above means it won't clobber a real
    // username if one gets recorded elsewhere later.
    upsertUser(userId, null);

    db.prepare(
      `INSERT INTO ai_conversations (user_id, chat_id, role, message, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(userId, chatId, role, message, new Date().toISOString());
  }

  function getRecentConversation(chatId, limit = 6) {
    return db
      .prepare('SELECT role, message FROM ai_conversations WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
      .all(chatId, limit)
      .reverse();
  }

  return {
    raw: db,
    getCachedExplanation,
    saveExplanation,
    upsertUser,
    recordAttempt,
    recordConversationTurn,
    getRecentConversation,
    close: () => db.close(),
  };
}

module.exports = { createDb };