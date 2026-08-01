-- StudyPal AI layer schema
-- Run automatically by db/db.js on startup (CREATE TABLE IF NOT EXISTS,
-- safe to apply repeatedly). Kept here as a readable reference.

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  first_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT,
  attempt_number INTEGER NOT NULL,
  is_correct INTEGER NOT NULL,
  time_taken_seconds REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_subject_topic
  ON attempts(user_id, subject, topic);

CREATE TABLE IF NOT EXISTS streaks (
  user_id TEXT PRIMARY KEY,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_active_date TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS explanation_cache (
  question_id TEXT PRIMARY KEY,
  explanation_text TEXT NOT NULL,
  memory_tip TEXT,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);