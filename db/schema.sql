-- StudyPal AI layer schema
-- Run automatically by db/db.js on startup (CREATE TABLE IF NOT EXISTS,
-- safe to apply repeatedly). Kept here as a readable reference.

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  phone_number TEXT,
  user_role TEXT NOT NULL DEFAULT 'student',
  subscription_plan TEXT NOT NULL DEFAULT 'free',
  subscription_expires_at TEXT,
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
CREATE INDEX IF NOT EXISTS idx_attempts_user_created_at
  ON attempts(user_id, created_at);

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT,
  total_questions INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  percentage REAL NOT NULL,
  time_taken_seconds REAL,
  ai_feedback TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_completed_at
  ON quiz_sessions(user_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_subject_completed_at
  ON quiz_sessions(user_id, subject, completed_at);

CREATE TABLE IF NOT EXISTS wrong_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT,
  question_text TEXT NOT NULL,
  options_json TEXT,
  correct_answer TEXT NOT NULL,
  student_answer TEXT,
  explanation_text TEXT,
  memory_tip TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES quiz_sessions(id),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_wrong_answers_user_created_at
  ON wrong_answers(user_id, created_at);

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

CREATE TABLE IF NOT EXISTS daily_goals (
  user_id TEXT PRIMARY KEY,
  goal_questions INTEGER NOT NULL DEFAULT 20,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL,
  badge_key TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_key),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
