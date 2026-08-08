const { normalizeSubject, getAvailableSubjects } = require('../services/questionService');

const SUBJECT_MENU_EMOJIS = ['1\u20e3', '2\u20e3', '3\u20e3', '4\u20e3', '5\u20e3', '6\u20e3', '7\u20e3', '8\u20e3', '9\u20e3', '\ud83d\udd1f'];

/**
 * Turns a raw subject key from questionService (e.g. "agricultural science",
 * "CRS") into something presentable, without mangling short acronym
 * subjects like "CRS" into "Crs".
 */
function capitalizeSubject(subject) {
  return String(subject || '')
    .split(' ')
    .map((word) => {
      if (!word) return word;
      if (word === word.toUpperCase() && word.length <= 4) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Builds the numbered subject menu shown when a user sends a bare "quiz"
 * with no subject. Subjects come straight from getAvailableSubjects() —
 * the actual live list — so the menu never drifts out of sync with what
 * subjects the quiz engine can actually serve.
 */
function buildSubjectMenu(subjects) {
  const lines = ['\ud83d\udcda *STUDYPAL QUIZ*', '', 'Choose a subject:', ''];

  subjects.forEach((subject, index) => {
    const marker = SUBJECT_MENU_EMOJIS[index] || `${index + 1}.`;
    lines.push(`${marker} ${capitalizeSubject(subject)}`);
  });

  lines.push('', 'Reply with the number of your choice.');
  return lines.join('\n');
}

/**
 * Shared quiz-start logic — used both by the direct "quiz <subject>" path
 * and by the subject-menu selection path in commandRouter.js, so there is
 * only ever one place that actually calls quizService.startQuiz.
 */
async function startQuizForSubject({ message, quizService, userId, username, subject, topic, pendingUpgradePrompts }) {
  if (topic) {
    await message.reply(`Searching for JAMB ${subject} questions on "${topic}". Give me a moment...`);
  }

  const result = await quizService.startQuiz({
    chatId: message.from,
    userId,
    username,
    subject,
    topic,
    reply: (text) => message.reply(text),
  });

  if (!result.started) {
    if (result.reason === 'daily_quiz_limit' && pendingUpgradePrompts) {
      pendingUpgradePrompts.set(userId, true);
    }
    await message.reply(result.message);
  }
}

async function handleQuizCommand({ message, args, quizService, userId, username, pendingUpgradePrompts, pendingSubjectSelections }) {
  if (message.from.endsWith('@g.us')) {
    await message.reply([
      '*StudyPal private tutor*',
      'Quizzes, scores, progress, explanations, streaks, and achievements happen in your private chat with StudyPal.',
      '',
      'Send me a DM with: quiz',
      'This group stays for questions, discussion, announcements, study tips, and motivation.',
    ].join('\n'));
    return;
  }

  // If a quiz is already running in this chat, defer to the exact same
  // "already running" behavior quizService.startQuiz has always had —
  // rather than confusingly showing a subject menu on top of it.
  if (quizService.hasActiveQuiz && quizService.hasActiveQuiz(message.from)) {
    await message.reply('A quiz is already running in this chat. Finish it before starting another one.');
    return;
  }

  const requestedSubject = normalizeSubject(args[0]);

  // No subject given ("quiz" on its own): show the numbered menu and
  // remember that this user is now choosing a subject, so their next
  // plain-number reply gets interpreted as a selection instead of a
  // command, a quiz answer, or a chat message to the AI tutor.
  if (!requestedSubject) {
    const subjects = getAvailableSubjects();
    if (pendingSubjectSelections) {
      pendingSubjectSelections.set(userId, subjects);
    }
    await message.reply(buildSubjectMenu(subjects));
    return;
  }

  // A subject was given directly ("quiz biology" / "quiz physics
  // electricity") — unchanged existing behavior, just no longer requires
  // a prefix. Clear any stale pending menu state for this user.
  if (pendingSubjectSelections) {
    pendingSubjectSelections.delete(userId);
  }

  await startQuizForSubject({
    message,
    quizService,
    userId,
    username,
    subject: requestedSubject,
    topic: args.slice(1).join(' ').trim(),
    pendingUpgradePrompts,
  });
}

module.exports = { handleQuizCommand, startQuizForSubject, buildSubjectMenu, capitalizeSubject };