-- StudyPal AI layer schema
-- Run automatically by db/db.js on startup (CREATE TABLE IF NOT EXISTS,
-- safe to apply repeatedly). Kept here as a readable reference.

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  phone_number TEXT,
  user_role TEXT NOT NULL DEFAULT 'student',
  subscription_plan TEXT NOT NULL DEFAULT 'free',
  subscription_activated_at TEXT,
  subscription_expires_at TEXT,
  first_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_daily_usage (
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  username TEXT,
  phone_number TEXT,
  selected_plan TEXT NOT NULL DEFAULT 'monthly',
  duration_days INTEGER NOT NULL DEFAULT 30,
  receipt_text TEXT,
  bank_name TEXT,
  amount_paid REAL,
  account_last4 TEXT,
  receipt_file_path TEXT,
  receipt_mimetype TEXT,
  receipt_filename TEXT,
  current_plan TEXT NOT NULL DEFAULT 'free',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  rejection_reason TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status_submitted
  ON payment_requests(payment_status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_submitted
  ON payment_requests(user_id, submitted_at);

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

CREATE TABLE IF NOT EXISTS shedshare_followups (
  chat_id TEXT PRIMARY KEY,
  outreach_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed', 'closed')),
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  followup_message_id TEXT
);

CREATE TABLE IF NOT EXISTS shedshare_leads (
  user_id TEXT PRIMARY KEY,
  lead_type TEXT NOT NULL CHECK(lead_type IN ('lister', 'renter')),
  prospect_name TEXT NOT NULL,
  location TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_profiles (
  business_key TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  description TEXT NOT NULL,
  offerings TEXT NOT NULL,
  target_customers TEXT NOT NULL,
  interaction_rules TEXT NOT NULL,
  followup_days INTEGER NOT NULL DEFAULT 3 CHECK(followup_days BETWEEN 1 AND 365),
  max_followups INTEGER NOT NULL DEFAULT 1 CHECK(max_followups BETWEEN 0 AND 20),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS business_leads (
  business_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_reply',
  outreach_message TEXT NOT NULL,
  outreach_at TEXT NOT NULL,
  last_customer_reply_at TEXT,
  followups_sent INTEGER NOT NULL DEFAULT 0,
  next_followup_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (business_key, user_id),
  FOREIGN KEY (business_key) REFERENCES business_profiles(business_key)
);

CREATE INDEX IF NOT EXISTS idx_business_leads_followup
  ON business_leads(status, next_followup_at);

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

CREATE TABLE IF NOT EXISTS coach_reading_passages (
  user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  title TEXT NOT NULL,
  passage TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, local_date)
);

CREATE TABLE IF NOT EXISTS coach_reading_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  score INTEGER NOT NULL,
  feedback TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_reading_attempts_user_date
  ON coach_reading_attempts(user_id, local_date);
