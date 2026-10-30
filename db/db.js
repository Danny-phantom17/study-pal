const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const OWNER_PROFILE = {
  name: 'Danny',
  phone: '+2347044438532',
};
const OWNER_PHONE_ALIASES = [OWNER_PROFILE.phone, '07044438532'];
const VIP_PROFILES = [
  { name: 'Shedrach', phone: '+2349031103913' },
  { name: 'Claudia', phone: '+2347060582146' },
  { name: 'Vivian', phone: '+2348130351163' },
  { name: 'Redrose', phone: '+2349076125785' },
];

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
  ensureColumn(db, 'users', 'phone_number', 'TEXT');
  ensureColumn(db, 'users', 'user_role', "TEXT NOT NULL DEFAULT 'student'");
  ensureColumn(db, 'users', 'subscription_plan', "TEXT NOT NULL DEFAULT 'free'");
  ensureColumn(db, 'users', 'subscription_activated_at', 'TEXT');
  ensureColumn(db, 'users', 'subscription_expires_at', 'TEXT');
  ensureColumn(db, 'payment_requests', 'bank_name', 'TEXT');
  ensureColumn(db, 'payment_requests', 'amount_paid', 'REAL');
  ensureColumn(db, 'payment_requests', 'account_last4', 'TEXT');

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
    const normalizedUserId = normalizeUserId(userId);
    db.prepare(
      `INSERT INTO users (user_id, username, phone_number, first_seen)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         username = COALESCE(excluded.username, users.username),
         phone_number = COALESCE(excluded.phone_number, users.phone_number)`
    ).run(normalizedUserId, username || null, phoneFromUserId(normalizedUserId), new Date().toISOString());
  }

  function getUserProfile(userId) {
    const normalizedUserId = normalizeUserId(userId);
    const row = db
      .prepare(
        `SELECT user_id, username, phone_number, user_role, subscription_plan, subscription_activated_at, subscription_expires_at, first_seen
         FROM users
         WHERE user_id = ?`
      )
      .get(normalizedUserId);

    if (!row) {
      upsertUser(normalizedUserId, null);
      return getUserProfile(normalizedUserId);
    }

    return {
      userId: row.user_id,
      name: row.username || 'Student',
      phoneNumber: row.phone_number || phoneFromUserId(row.user_id),
      role: normalizeRole(row.user_role),
      subscriptionPlan: row.subscription_plan || 'free',
      subscriptionActivatedAt: row.subscription_activated_at || null,
      subscriptionExpiresAt: row.subscription_expires_at || null,
      firstSeen: row.first_seen,
    };
  }

  function updateSubscription({ userId, plan, expiresAt, activatedAt }) {
    const normalizedUserId = normalizeUserId(userId);
    upsertUser(normalizedUserId, null);
    const normalizedPlan = normalizePlan(plan);
    const activationValue = normalizedPlan === 'premium'
      ? activatedAt || new Date().toISOString()
      : null;

    db.prepare(
      `UPDATE users
       SET subscription_plan = ?, subscription_activated_at = ?, subscription_expires_at = ?
       WHERE user_id = ?`
    ).run(normalizedPlan, activationValue, expiresAt || null, normalizedUserId);
  }

  function updateUserRole({ userId, role, username }) {
    const normalizedUserId = normalizeUserId(userId);
    upsertUser(normalizedUserId, username || null);
    const normalizedRole = normalizeRole(role);

    if (isOwnerUserId(normalizedUserId) && normalizedRole !== 'owner') {
      throw new Error('The StudyPal owner role cannot be removed.');
    }

    db.prepare(
      `UPDATE users
       SET user_role = ?, username = COALESCE(?, username)
       WHERE user_id = ?`
    ).run(normalizedRole, username || null, normalizedUserId);
  }

  function getSubscriptionStatus(userId, now = new Date()) {
    const profile = getUserProfile(normalizeUserId(userId));
    const plan = normalizePlan(profile.subscriptionPlan);
    const expiresAt = profile.subscriptionExpiresAt;
    const role = normalizeRole(profile.role);
    const hasRoleAccess = ['owner', 'admin', 'vip'].includes(role);
    const hasPaidPremium = plan === 'premium' && (!expiresAt || new Date(expiresAt) > now);
    const isPremium = hasRoleAccess || hasPaidPremium;

    return {
      plan: isPremium ? 'premium' : 'free',
      storedPlan: plan,
      role,
      expiresAt,
      isPremium,
      hasRoleAccess,
      hasManagementAccess: role === 'owner' || role === 'admin',
      isExpired: plan === 'premium' && Boolean(expiresAt) && new Date(expiresAt) <= now,
    };
  }

  function hasManagementAccess(userId) {
    return getSubscriptionStatus(userId).hasManagementAccess;
  }

  function hasOwnerAccess(userId) {
    return isOwnerUserId(userId);
  }

  // --- Attempts ---

  function recordAttempt({ userId, questionId, subject, topic, attemptNumber, isCorrect, timeTakenSeconds }) {
    const normalizedUserId = normalizeUserId(userId);
    upsertUser(normalizedUserId, null);
    db.prepare(
      `INSERT INTO attempts (user_id, question_id, subject, topic, attempt_number, is_correct, time_taken_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      normalizedUserId,
      questionId,
      subject,
      topic || null,
      attemptNumber,
      isCorrect ? 1 : 0,
      timeTakenSeconds || null,
      new Date().toISOString()
    );
  }

  function updateStudyStreak(userId, date = localDateString()) {
    const normalizedUserId = normalizeUserId(userId);
    upsertUser(normalizedUserId, null);

    const row = db
      .prepare('SELECT current_streak, longest_streak, last_active_date FROM streaks WHERE user_id = ?')
      .get(normalizedUserId);

    if (!row) {
      db.prepare(
        `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
         VALUES (?, 1, 1, ?)`
      ).run(normalizedUserId, date);
      return { currentStreak: 1, longestStreak: 1, lastActiveDate: date };
    }

    if (row.last_active_date === date) {
      return {
        currentStreak: row.current_streak || 0,
        longestStreak: row.longest_streak || 0,
        lastActiveDate: row.last_active_date,
      };
    }

    const yesterday = addDays(date, -1);
    const currentStreak = row.last_active_date === yesterday ? (row.current_streak || 0) + 1 : 1;
    const longestStreak = Math.max(currentStreak, row.longest_streak || 0);

    db.prepare(
      `UPDATE streaks
       SET current_streak = ?, longest_streak = ?, last_active_date = ?
       WHERE user_id = ?`
    ).run(currentStreak, longestStreak, date, normalizedUserId);

    return { currentStreak, longestStreak, lastActiveDate: date };
  }

  function getStreak(userId) {
    const normalizedUserId = normalizeUserId(userId);
    const row = db
      .prepare('SELECT current_streak, longest_streak, last_active_date FROM streaks WHERE user_id = ?')
      .get(normalizedUserId);

    return {
      currentStreak: row?.current_streak || 0,
      longestStreak: row?.longest_streak || 0,
      lastActiveDate: row?.last_active_date || null,
    };
  }

  function createQuizSession({
    userId,
    chatId,
    subject,
    topic,
    totalQuestions,
    correctCount,
    percentage,
    timeTakenSeconds,
    aiFeedback,
    startedAt,
    completedAt,
  }) {
    const normalizedUserId = normalizeUserId(userId);
    upsertUser(normalizedUserId, null);

    const result = db.prepare(
      `INSERT INTO quiz_sessions
        (user_id, chat_id, subject, topic, total_questions, correct_count, percentage, time_taken_seconds, ai_feedback, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      normalizedUserId,
      chatId,
      subject,
      topic || null,
      totalQuestions,
      correctCount,
      percentage,
      timeTakenSeconds || null,
      aiFeedback || null,
      startedAt,
      completedAt
    );

    return Number(result.lastInsertRowid);
  }

  function recordWrongAnswer({
    sessionId,
    userId,
    question,
    subject,
    topic,
    studentAnswer,
    explanation,
    memoryTip,
    createdAt = new Date().toISOString(),
  }) {
    const normalizedUserId = normalizeUserId(userId);
    upsertUser(normalizedUserId, null);

    db.prepare(
      `INSERT INTO wrong_answers
        (session_id, user_id, question_id, subject, topic, question_text, options_json, correct_answer, student_answer, explanation_text, memory_tip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId || null,
      normalizedUserId,
      question.id,
      subject,
      topic || question.topic || null,
      question.question,
      JSON.stringify(question.options || []),
      question.answer,
      studentAnswer || null,
      explanation || null,
      memoryTip || null,
      createdAt
    );
  }

  function getQuizHistory(userId, limit = 10) {
    return db
      .prepare(
        `SELECT id, subject, topic, total_questions, correct_count, percentage, time_taken_seconds, ai_feedback, completed_at
         FROM quiz_sessions
         WHERE user_id = ?
         ORDER BY completed_at DESC
         LIMIT ?`
      )
      .all(userId, limit);
  }

  function getPreviousSubjectSession(userId, subject, beforeIso) {
    return db
      .prepare(
        `SELECT id, percentage, completed_at
         FROM quiz_sessions
         WHERE user_id = ? AND subject = ? AND completed_at < ?
         ORDER BY completed_at DESC
         LIMIT 1`
      )
      .get(userId, subject, beforeIso);
  }

  function getPersonalStats(userId) {
    const totals = db
      .prepare(
        `SELECT
           COUNT(*) AS total_quizzes,
           COALESCE(SUM(total_questions), 0) AS total_questions,
           COALESCE(AVG(percentage), 0) AS average_score,
           COALESCE(MAX(percentage), 0) AS highest_score
         FROM quiz_sessions
         WHERE user_id = ?`
      )
      .get(userId);

    const bestSubject = db
      .prepare(
        `SELECT subject, AVG(percentage) AS average_score, COUNT(*) AS quiz_count
         FROM quiz_sessions
         WHERE user_id = ?
         GROUP BY subject
         HAVING COUNT(*) > 0
         ORDER BY average_score DESC, quiz_count DESC
         LIMIT 1`
      )
      .get(userId);

    const streak = getStreak(userId);

    return {
      totalQuizzes: totals?.total_quizzes || 0,
      totalQuestions: totals?.total_questions || 0,
      averageScore: totals?.average_score || 0,
      highestScore: totals?.highest_score || 0,
      bestSubject: bestSubject?.subject || null,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    };
  }

  function setDailyGoal(userId, goalQuestions) {
    upsertUser(userId, null);
    db.prepare(
      `INSERT INTO daily_goals (user_id, goal_questions, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         goal_questions = excluded.goal_questions,
         updated_at = excluded.updated_at`
    ).run(userId, goalQuestions, new Date().toISOString());
  }

  function getDailyGoal(userId) {
    const row = db.prepare('SELECT goal_questions FROM daily_goals WHERE user_id = ?').get(userId);
    return row?.goal_questions || 20;
  }

  function getDailyGoalProgress(userId, date = localDateString()) {
    const goalQuestions = getDailyGoal(userId);
    const { start, end } = utcWindowForLocalDate(date);
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT question_id) AS answered
         FROM attempts
         WHERE user_id = ? AND created_at >= ? AND created_at < ?`
      )
      .get(userId, start, end);
    const answered = row?.answered || 0;

    return {
      goalQuestions,
      answered,
      percentage: goalQuestions > 0 ? Math.min(100, (answered / goalQuestions) * 100) : 0,
    };
  }

  function countQuizSessionsForDate(userId, date = localDateString()) {
    const normalizedUserId = normalizeUserId(userId);
    const { start, end } = utcWindowForLocalDate(date);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM quiz_sessions
         WHERE user_id = ? AND completed_at >= ? AND completed_at < ?`
      )
      .get(normalizedUserId, start, end);

    return row?.count || 0;
  }

  function countQuestionsAnsweredForDate(userId, date = localDateString()) {
    const normalizedUserId = normalizeUserId(userId);
    const { start, end } = utcWindowForLocalDate(date);
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT question_id) AS count
         FROM attempts
         WHERE user_id = ? AND created_at >= ? AND created_at < ?`
      )
      .get(normalizedUserId, start, end);

    return row?.count || 0;
  }

  function listSubjectsAnsweredForDate(userId, date = localDateString()) {
    const normalizedUserId = normalizeUserId(userId);
    const { start, end } = utcWindowForLocalDate(date);
    return db
      .prepare(
        `SELECT DISTINCT subject
         FROM attempts
         WHERE user_id = ? AND created_at >= ? AND created_at < ?
         ORDER BY subject ASC`
      )
      .all(normalizedUserId, start, end)
      .map((row) => row.subject)
      .filter(Boolean);
  }

  function getRecentWrongAnswers(userId, limit = 10) {
    return db
      .prepare(
        `SELECT subject, topic, question_text, options_json, correct_answer, student_answer, explanation_text, memory_tip, created_at
         FROM wrong_answers
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, limit)
      .map((row) => ({
        ...row,
        options: safeParseJson(row.options_json, []),
      }));
  }

  function getWeeklyReport(userId, now = new Date()) {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const previousStart = new Date(now);
    previousStart.setDate(previousStart.getDate() - 14);

    const current = getReportWindow(userId, start.toISOString(), end.toISOString());
    const previous = getReportWindow(userId, previousStart.toISOString(), start.toISOString());

    return {
      ...current,
      previousAverageScore: previous.averageScore,
      averageScoreChange: current.averageScore - previous.averageScore,
    };
  }

  function getAdvancedAnalytics(userId) {
    const subjects = db
      .prepare(
        `SELECT
           subject,
           COUNT(*) AS quizzes,
           COALESCE(SUM(total_questions), 0) AS questions_answered,
           COALESCE(AVG(percentage), 0) AS average_score,
           COALESCE(MAX(percentage), 0) AS highest_score,
           MIN(completed_at) AS first_completed_at,
           MAX(completed_at) AS last_completed_at
         FROM quiz_sessions
         WHERE user_id = ?
         GROUP BY subject
         ORDER BY average_score DESC`
      )
      .all(userId);

    const weakestTopics = db
      .prepare(
        `SELECT subject, COALESCE(topic, 'general') AS topic, COUNT(*) AS misses
         FROM wrong_answers
         WHERE user_id = ?
         GROUP BY subject, COALESCE(topic, 'general')
         ORDER BY misses DESC
         LIMIT 5`
      )
      .all(userId);

    const recentTrend = db
      .prepare(
        `SELECT subject, percentage, completed_at
         FROM quiz_sessions
         WHERE user_id = ?
         ORDER BY completed_at DESC
         LIMIT 10`
      )
      .all(userId);

    return { subjects, weakestTopics, recentTrend };
  }

  function getReportWindow(userId, startIso, endIso) {
    const summary = db
      .prepare(
        `SELECT
           COUNT(*) AS quizzes,
           COALESCE(SUM(total_questions), 0) AS questions_answered,
           COALESCE(AVG(percentage), 0) AS average_score
         FROM quiz_sessions
         WHERE user_id = ? AND completed_at >= ? AND completed_at < ?`
      )
      .get(userId, startIso, endIso);

    const days = db
      .prepare(
        `SELECT COUNT(DISTINCT substr(completed_at, 1, 10)) AS days_studied
         FROM quiz_sessions
         WHERE user_id = ? AND completed_at >= ? AND completed_at < ?`
      )
      .get(userId, startIso, endIso);

    const best = db
      .prepare(
        `SELECT subject, AVG(percentage) AS average_score
         FROM quiz_sessions
         WHERE user_id = ? AND completed_at >= ? AND completed_at < ?
         GROUP BY subject
         ORDER BY average_score DESC
         LIMIT 1`
      )
      .get(userId, startIso, endIso);

    return {
      daysStudied: days?.days_studied || 0,
      quizzes: summary?.quizzes || 0,
      questionsAnswered: summary?.questions_answered || 0,
      averageScore: summary?.average_score || 0,
      bestSubject: best?.subject || null,
    };
  }

  function unlockAchievement(userId, badgeKey, badgeName) {
    upsertUser(userId, null);
    const result = db.prepare(
      `INSERT OR IGNORE INTO achievements (user_id, badge_key, badge_name, unlocked_at)
       VALUES (?, ?, ?, ?)`
    ).run(userId, badgeKey, badgeName, new Date().toISOString());

    return result.changes > 0 ? { badgeKey, badgeName } : null;
  }

  function getAchievements(userId) {
    return db
      .prepare(
        `SELECT badge_key, badge_name, unlocked_at
         FROM achievements
         WHERE user_id = ?
         ORDER BY unlocked_at ASC`
      )
      .all(userId);
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

  function claimShedShareFollowup(chatId, outreachMessageId) {
    const now = new Date().toISOString();
    const staleClaimBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const result = db.prepare(
      `INSERT INTO shedshare_followups (chat_id, outreach_message_id, status, claimed_at)
       VALUES (?, ?, 'pending', ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         outreach_message_id = excluded.outreach_message_id,
         status = 'pending',
         claimed_at = excluded.claimed_at,
         sent_at = NULL,
         followup_message_id = NULL
       WHERE shedshare_followups.status = 'failed'
          OR (shedshare_followups.status = 'pending' AND shedshare_followups.claimed_at < ?)`
    ).run(chatId, outreachMessageId, now, staleClaimBefore);
    return result.changes > 0;
  }

  function hasShedShareFollowupClaim(chatId) {
    const row = db.prepare(
      `SELECT status FROM shedshare_followups WHERE chat_id = ?`
    ).get(chatId);
    return Boolean(row && row.status !== 'failed');
  }

  function markShedShareFollowupSent(chatId, followupMessageId) {
    db.prepare(
      `UPDATE shedshare_followups
       SET status = 'sent', sent_at = ?, followup_message_id = ?
       WHERE chat_id = ? AND status = 'pending'`
    ).run(new Date().toISOString(), followupMessageId || null, chatId);
  }

  function markShedShareFollowupFailed(chatId) {
    db.prepare(
      `UPDATE shedshare_followups SET status = 'failed' WHERE chat_id = ? AND status = 'pending'`
    ).run(chatId);
  }

  function markShedShareFollowupClosed(chatId) {
    db.prepare(
      `UPDATE shedshare_followups SET status = 'closed' WHERE chat_id = ? AND status = 'pending'`
    ).run(chatId);
  }

  function upsertShedShareLead({ userId, leadType, name, location, source = 'command' }) {
    const normalizedUserId = normalizeUserId(userId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shedshare_leads (user_id, lead_type, prospect_name, location, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         lead_type = excluded.lead_type,
         prospect_name = excluded.prospect_name,
         location = excluded.location,
         source = excluded.source,
         updated_at = excluded.updated_at`
    ).run(normalizedUserId, leadType, name, location, source, now, now);
  }

  function getShedShareLead(userId) {
    const normalizedUserId = normalizeUserId(userId);
    const row = db.prepare(
      `SELECT user_id, lead_type, prospect_name, location, source
       FROM shedshare_leads WHERE user_id = ?`
    ).get(normalizedUserId);
    if (!row) return null;
    return {
      userId: row.user_id,
      leadType: row.lead_type,
      name: row.prospect_name,
      location: row.location,
      source: row.source,
    };
  }

  function getShedShareLeads() {
    return db.prepare(
      `SELECT user_id, lead_type, prospect_name, location, source, created_at, updated_at
       FROM shedshare_leads ORDER BY updated_at DESC, prospect_name COLLATE NOCASE`
    ).all().map((row) => ({
      userId: row.user_id,
      leadType: row.lead_type,
      name: row.prospect_name,
      location: row.location,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  function upsertBusinessProfile(profile) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO business_profiles
        (business_key, business_name, description, offerings, target_customers, interaction_rules, followup_days, max_followups, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(business_key) DO UPDATE SET
         business_name = excluded.business_name, description = excluded.description,
         offerings = excluded.offerings, target_customers = excluded.target_customers,
         interaction_rules = excluded.interaction_rules, followup_days = excluded.followup_days,
         max_followups = excluded.max_followups, enabled = 1, updated_at = excluded.updated_at`
    ).run(profile.key, profile.name, profile.description, profile.offerings, profile.targetCustomers,
      profile.interactionRules, profile.followupDays, profile.maxFollowups, now, now);
  }

  function listBusinessProfiles() {
    return db.prepare('SELECT * FROM business_profiles WHERE enabled = 1 ORDER BY business_name COLLATE NOCASE').all()
      .map(mapBusinessProfile);
  }

  function getBusinessProfile(key) {
    const row = db.prepare('SELECT * FROM business_profiles WHERE business_key = ? AND enabled = 1').get(String(key).toLowerCase());
    return row ? mapBusinessProfile(row) : null;
  }

  function recordBusinessOutreach({ businessKey, userId, contactName, location, outreachMessage, followupAt }) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO business_leads
        (business_key, user_id, contact_name, location, status, outreach_message, outreach_at, next_followup_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'awaiting_reply', ?, ?, ?, ?, ?)
       ON CONFLICT(business_key, user_id) DO UPDATE SET
         contact_name = excluded.contact_name, location = excluded.location, status = 'awaiting_reply',
         outreach_message = excluded.outreach_message, outreach_at = excluded.outreach_at,
         last_customer_reply_at = NULL, followups_sent = 0, next_followup_at = excluded.next_followup_at,
         updated_at = excluded.updated_at`
    ).run(businessKey, normalizeUserId(userId), contactName, location, outreachMessage, now, followupAt, now, now);
  }

  function getBusinessLead(userId) {
    const row = db.prepare(
      `SELECT l.*, p.business_name, p.description, p.offerings, p.target_customers, p.interaction_rules,
              p.followup_days, p.max_followups
       FROM business_leads l JOIN business_profiles p ON p.business_key = l.business_key
       WHERE l.user_id = ? AND p.enabled = 1 ORDER BY l.updated_at DESC LIMIT 1`
    ).get(normalizeUserId(userId));
    return row ? { ...row, businessKey: row.business_key, businessName: row.business_name } : null;
  }

  function listBusinessLeads(businessKey) {
    return db.prepare(
      `SELECT user_id, contact_name, location, status, outreach_at, followups_sent
       FROM business_leads WHERE business_key = ? ORDER BY updated_at DESC`
    ).all(String(businessKey).toLowerCase());
  }

  function listBusinessLeads(businessKey) {
    return db.prepare(
      `SELECT user_id, contact_name, location, status, outreach_at, followups_sent
       FROM business_leads WHERE business_key = ? ORDER BY updated_at DESC`
    ).all(String(businessKey).toLowerCase());
  }

  function markBusinessLeadReplied(userId) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE business_leads SET status = 'replied', last_customer_reply_at = ?, next_followup_at = NULL, updated_at = ?
       WHERE user_id = ? AND status = 'awaiting_reply'`
    ).run(now, now, normalizeUserId(userId));
  }

  function listDueBusinessFollowups(now = new Date().toISOString()) {
    return db.prepare(
      `SELECT l.*, p.business_name, p.description, p.offerings, p.target_customers, p.interaction_rules,
              p.followup_days, p.max_followups
       FROM business_leads l JOIN business_profiles p ON p.business_key = l.business_key
       WHERE l.status = 'awaiting_reply' AND l.next_followup_at IS NOT NULL
         AND l.next_followup_at <= ? AND l.followups_sent < p.max_followups AND p.enabled = 1
       ORDER BY l.next_followup_at LIMIT 10`
    ).all(now).map((row) => ({ ...row, businessKey: row.business_key, businessName: row.business_name }));
  }

  function markBusinessFollowupSent(businessKey, userId, nextFollowupAt) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE business_leads SET followups_sent = followups_sent + 1,
         next_followup_at = ?, updated_at = ?,
         status = CASE WHEN followups_sent + 1 >= (SELECT max_followups FROM business_profiles WHERE business_key = ?) THEN 'followups_done' ELSE status END
       WHERE business_key = ? AND user_id = ? AND status = 'awaiting_reply'`
    ).run(nextFollowupAt, now, businessKey, businessKey, normalizeUserId(userId));
  }

  // --- Daily AI usage ---

  function getAiUsageForDate(userId, date = localDateString()) {
    upsertUser(userId, null);
    const row = db
      .prepare('SELECT message_count FROM ai_daily_usage WHERE user_id = ? AND usage_date = ?')
      .get(userId, date);

    return row?.message_count || 0;
  }

  function incrementAiUsageForDate(userId, date = localDateString()) {
    upsertUser(userId, null);
    db.prepare(
      `INSERT INTO ai_daily_usage (user_id, usage_date, message_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET
         message_count = ai_daily_usage.message_count + 1,
         updated_at = excluded.updated_at`
    ).run(userId, date, new Date().toISOString());

    return getAiUsageForDate(userId, date);
  }

  // --- Premium payment requests ---

  function createPaymentRequest({
    userId,
    username,
    selectedPlan,
    durationDays,
    receiptText,
    currentPlan,
    bankName,
    amountPaid,
    accountLast4,
  }) {
    const normalizedUserId = normalizeUserId(userId);
    upsertUser(normalizedUserId, username || null);
    const profile = getUserProfile(normalizedUserId);
    const result = db.prepare(
      `INSERT INTO payment_requests
        (user_id, username, phone_number, selected_plan, duration_days, receipt_text,
         bank_name, amount_paid, account_last4, current_plan, payment_status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      normalizedUserId,
      username || profile.name || null,
      profile.phoneNumber || phoneFromUserId(normalizedUserId),
      selectedPlan || 'monthly',
      Number(durationDays || 30),
      receiptText || null,
      bankName || null,
      amountPaid === null || amountPaid === undefined ? null : Number(amountPaid),
      accountLast4 || null,
      currentPlan || getSubscriptionStatus(normalizedUserId).plan,
      new Date().toISOString()
    );

    return Number(result.lastInsertRowid);
  }

  function updatePaymentRequestReceipt({ requestId, filePath, mimetype, filename }) {
    db.prepare(
      `UPDATE payment_requests
       SET receipt_file_path = ?, receipt_mimetype = ?, receipt_filename = ?
       WHERE id = ?`
    ).run(filePath || null, mimetype || null, filename || null, requestId);
  }

  function getPaymentRequest(requestId) {
    return db
      .prepare(
        `SELECT id, user_id, username, phone_number, selected_plan, duration_days, receipt_text,
                bank_name, amount_paid, account_last4,
                receipt_file_path, receipt_mimetype, receipt_filename, current_plan,
                payment_status, submitted_at, reviewed_at, reviewed_by, rejection_reason
         FROM payment_requests
         WHERE id = ?`
      )
      .get(requestId);
  }

  function listPendingPaymentRequests(limit = 10) {
    return db
      .prepare(
        `SELECT id, user_id, username, phone_number, selected_plan, duration_days, receipt_text,
                bank_name, amount_paid, account_last4,
                receipt_file_path, receipt_mimetype, receipt_filename, current_plan,
                payment_status, submitted_at
         FROM payment_requests
         WHERE payment_status = 'pending'
         ORDER BY submitted_at ASC
         LIMIT ?`
      )
      .all(limit);
  }

  function updatePaymentRequestStatus({ requestId, status, reviewedBy, rejectionReason }) {
    db.prepare(
      `UPDATE payment_requests
       SET payment_status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ?
       WHERE id = ?`
    ).run(status, new Date().toISOString(), reviewedBy || null, rejectionReason || null, requestId);

    return getPaymentRequest(requestId);
  }

  function getSubscriptionDashboardStats(now = new Date()) {
    const rows = db
      .prepare(
        `SELECT user_id, user_role, subscription_plan, subscription_expires_at
         FROM users`
      )
      .all();
    const nowTime = now.getTime();
    const pendingPaymentRequests = db
      .prepare("SELECT COUNT(*) AS count FROM payment_requests WHERE payment_status = 'pending'")
      .get()?.count || 0;

    return rows.reduce((stats, row) => {
      const role = normalizeRole(row.user_role);
      const plan = normalizePlan(row.subscription_plan);
      const expiresAt = row.subscription_expires_at;
      const isExpired = plan === 'premium' && Boolean(expiresAt) && new Date(expiresAt).getTime() <= nowTime;
      const hasRoleAccess = ['owner', 'admin', 'vip'].includes(role);
      const hasActivePremiumPlan = plan === 'premium' && !isExpired;

      stats.totalUsers += 1;
      if (role === 'vip') stats.vipUsers += 1;
      if (isExpired) stats.expiredPremiumUsers += 1;
      if (!hasRoleAccess && hasActivePremiumPlan) stats.premiumUsers += 1;
      if (!hasRoleAccess && !hasActivePremiumPlan) stats.freeUsers += 1;

      return stats;
    }, {
      totalUsers: 0,
      freeUsers: 0,
      premiumUsers: 0,
      vipUsers: 0,
      expiredPremiumUsers: 0,
      pendingPaymentRequests,
    });
  }

  function getCoachReadingPassage(userId, localDate) {
    return db.prepare(
      'SELECT title, passage FROM coach_reading_passages WHERE user_id = ? AND local_date = ?'
    ).get(normalizeUserId(userId), localDate) || null;
  }

  function saveCoachReadingPassage({ userId, localDate, title, passage }) {
    db.prepare(
      `INSERT INTO coach_reading_passages (user_id, local_date, title, passage, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, local_date) DO NOTHING`
    ).run(normalizeUserId(userId), localDate, title, passage, new Date().toISOString());
    return getCoachReadingPassage(userId, localDate);
  }

  function recordCoachReadingAttempt({ userId, localDate, score, feedback }) {
    db.prepare(
      `INSERT INTO coach_reading_attempts (user_id, local_date, score, feedback, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      normalizeUserId(userId),
      localDate,
      Math.max(0, Math.min(100, Math.round(Number(score) || 0))),
      feedback,
      new Date().toISOString(),
    );
  }

  function getCoachReadingStats(userId) {
    return db.prepare(
      `SELECT COUNT(*) AS attempts, ROUND(AVG(score)) AS average_score,
              MAX(score) AS best_score
       FROM coach_reading_attempts WHERE user_id = ?`
    ).get(normalizeUserId(userId));
  }

  seedSystemRoles();

  return {
    raw: db,
    getCachedExplanation,
    saveExplanation,
    upsertUser,
    recordAttempt,
    updateStudyStreak,
    getStreak,
    createQuizSession,
    recordWrongAnswer,
    getQuizHistory,
    getPreviousSubjectSession,
    getPersonalStats,
    setDailyGoal,
    getDailyGoal,
    getDailyGoalProgress,
    countQuizSessionsForDate,
    countQuestionsAnsweredForDate,
    listSubjectsAnsweredForDate,
    getRecentWrongAnswers,
    getWeeklyReport,
    getAdvancedAnalytics,
    unlockAchievement,
    getAchievements,
    getUserProfile,
    updateSubscription,
    updateUserRole,
    getSubscriptionStatus,
    hasManagementAccess,
    hasOwnerAccess,
    recordConversationTurn,
    getRecentConversation,
    claimShedShareFollowup,
    hasShedShareFollowupClaim,
    markShedShareFollowupSent,
    markShedShareFollowupFailed,
    markShedShareFollowupClosed,
    upsertShedShareLead,
    getShedShareLead,
    getShedShareLeads,
    upsertBusinessProfile,
    listBusinessProfiles,
    getBusinessProfile,
    recordBusinessOutreach,
    getBusinessLead,
    listBusinessLeads,
    listBusinessLeads,
    markBusinessLeadReplied,
    listDueBusinessFollowups,
    markBusinessFollowupSent,
    getAiUsageForDate,
    incrementAiUsageForDate,
    createPaymentRequest,
    updatePaymentRequestReceipt,
    getPaymentRequest,
    listPendingPaymentRequests,
    updatePaymentRequestStatus,
    getSubscriptionDashboardStats,
    getCoachReadingPassage,
    saveCoachReadingPassage,
    recordCoachReadingAttempt,
    getCoachReadingStats,
    normalizeUserId,
    close: () => db.close(),
  };

  function seedSystemRoles() {
    const ownerUserId = userIdFromPhone(OWNER_PROFILE.phone);
    upsertUser(ownerUserId, OWNER_PROFILE.name);
    db.prepare(
      `UPDATE users
       SET user_role = 'owner', subscription_plan = 'premium', subscription_expires_at = NULL
       WHERE user_id = ?`
    ).run(ownerUserId);

    VIP_PROFILES.forEach((vip) => {
      const vipUserId = userIdFromPhone(vip.phone);
      upsertUser(vipUserId, vip.name);
      db.prepare(
        `UPDATE users
         SET user_role = 'vip'
         WHERE user_id = ? AND user_role != 'owner'`
      ).run(vipUserId);
    });
  }
}

function localDateString(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function utcWindowForLocalDate(dateString) {
  const [year, month, day] = String(dateString || localDateString()).split('-').map(Number);
  const startDate = new Date(year, month - 1, day);
  const endDate = new Date(year, month - 1, day + 1);

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function phoneFromUserId(userId) {
  return normalizePhoneDigits(userId);
}

function normalizePlan(plan) {
  return String(plan || 'free').trim().toLowerCase() === 'premium' ? 'premium' : 'free';
}

function normalizeRole(role) {
  const normalized = String(role || 'student').trim().toLowerCase();
  return ['owner', 'admin', 'vip', 'student'].includes(normalized) ? normalized : 'student';
}

function userIdFromPhone(phone) {
  const digits = normalizePhoneDigits(phone);
  return digits ? `${digits}@c.us` : String(phone || '');
}

function isOwnerUserId(userId) {
  const ownerDigits = normalizePhoneDigits(userId);
  return OWNER_PHONE_ALIASES.some((phone) => normalizePhoneDigits(phone) === ownerDigits);
}

function normalizeUserId(userId) {
  const digits = normalizePhoneDigits(userId);
  return digits ? `${digits}@c.us` : String(userId || '');
}

function normalizePhoneDigits(value) {
  const beforeDomain = String(value || '').split('@')[0];
  const beforeDevice = beforeDomain.split(':')[0];
  let digits = beforeDevice.replace(/\D/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('2340')) {
    digits = `234${digits.slice(4)}`;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = `234${digits.slice(1)}`;
  } else if (digits.length === 10 && /^[789]/.test(digits)) {
    digits = `234${digits}`;
  }

  return digits || null;
}

function ensureColumn(db, tableName, columnName, definition) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName) || !/^[a-z_][a-z0-9_]*$/i.test(columnName)) {
    throw new Error(`Unsafe migration identifier: ${tableName}.${columnName}`);
  }

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function mapBusinessProfile(row) {
  return {
    key: row.business_key,
    name: row.business_name,
    description: row.description,
    offerings: row.offerings,
    targetCustomers: row.target_customers,
    interactionRules: row.interaction_rules,
    followupDays: row.followup_days,
    maxFollowups: row.max_followups,
  };
}

module.exports = { createDb };
