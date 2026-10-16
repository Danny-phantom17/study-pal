'use strict';

const COACH_PROMPT = `You are a patient one-to-one reading coach for a young learner who is still building confidence. Always use clear, simple, grammatically correct standard English. Never use Nigerian Pidgin, slang, or local dialect. Be warm and respectful; never shame the learner. Give short instructions, one step at a time.`;

function createReadingCoachService({ aiProvider, db }) {
  async function start({ userId, reply }) {
    const localDate = nigeriaDate();
    let passage = db.getCoachReadingPassage(userId, localDate);

    if (!passage) {
      const raw = await aiProvider.generateCompletion({
        systemPrompt: `${COACH_PROMPT} Create one original daily reading exercise. It must have a short title, followed by a friendly passage of 55 to 75 easy words suitable for a beginner reader. Use familiar everyday topics, short sentences, and common words. Do not include Pidgin. Return only JSON: {"title":"...","passage":"..."}.`,
        userPrompt: 'Create today’s reading passage. Do not repeat a passage from earlier in this conversation.',
      });
      passage = parsePassage(raw);
      passage = db.saveCoachReadingPassage({ userId, localDate, ...passage });
    }

    const stats = db.getCoachReadingStats(userId);
    const progress = stats.attempts
      ? `\n\nYour reading record: ${stats.attempts} attempt${stats.attempts === 1 ? '' : 's'}, average score ${stats.average_score || 0}/100. Your best score is ${stats.best_score || 0}/100.`
      : '';

    await reply([
      `*Today’s reading practice: ${passage.title}*`,
      '',
      passage.passage,
      '',
      'Read this aloud in a voice note and send it to me. I will listen, give you a kind score, and help you practise. You can also send a clear photo of your school assignment, and we will work through it together.',
      'Send *coach off* to leave reading-coach mode.',
      progress,
    ].filter(Boolean).join('\n'));
  }

  async function handleMessage({ userId, text, media, reply }) {
    const localDate = nigeriaDate();
    const passage = db.getCoachReadingPassage(userId, localDate);
    const normalizedText = String(text || '').trim().toLowerCase();

    if (!media?.length && ['score', 'my score', 'progress'].includes(normalizedText)) {
      const stats = db.getCoachReadingStats(userId);
      await reply(stats.attempts
        ? `You have completed ${stats.attempts} reading attempt${stats.attempts === 1 ? '' : 's'}. Your average score is ${stats.average_score || 0}/100, and your best score is ${stats.best_score || 0}/100. Keep practising a little each day!`
        : 'You have not recorded a reading score yet. Type coach to get today’s passage, then send a voice note while reading it aloud.');
      return;
    }

    const readingContext = passage
      ? `Today’s reading passage is titled “${passage.title}”:\n${passage.passage}`
      : 'The learner has not opened today’s reading passage yet.';
    const raw = await aiProvider.generateCompletion({
      systemPrompt: `${COACH_PROMPT} Help with the learner’s latest message and attached media. If there is an image of schoolwork, read it carefully, explain the instructions in simple steps, and help the learner work out the answer instead of only giving an unexplained answer. If there is audio, decide whether it is the learner reading the passage below or asking a spoken question. For a reading, estimate a supportive practice score from 0 to 100 based on how much of the passage is read clearly and accurately; do not claim perfect pronunciation analysis when uncertain. Give one specific thing done well and one small next step. If it is a spoken question, answer it simply. Return only JSON with this exact shape: {"kind":"reading" or "answer","score":integer,"transcription":"...","feedback":"...","answer":"..."}. Use kind=reading only when the audio is an attempt to read the passage.\n\n${readingContext}`,
      userPrompt: [
        normalizedText ? `Learner’s message: ${String(text).trim()}` : 'The learner sent media without a text caption.',
        media?.length ? 'Please inspect/listen to the attached media.' : '',
      ].filter(Boolean).join('\n'),
      media,
    });

    const result = parseCoachResponse(raw);
    if (result.kind === 'reading' && passage) {
      db.recordCoachReadingAttempt({
        userId,
        localDate,
        score: result.score,
        feedback: result.feedback,
      });
      const stats = db.getCoachReadingStats(userId);
      await reply([
        `*Reading practice score: ${result.score}/100*`,
        result.feedback,
        stats.attempts > 1 ? `Your average score is now ${stats.average_score}/100. Your best is ${stats.best_score}/100.` : '',
        'You can try the passage again, or send a photo of an assignment for help.',
      ].filter(Boolean).join('\n\n'));
      return;
    }

    await reply(result.answer || result.feedback || 'I could not understand that clearly. Please send it again, or type a short question.');
  }

  return { start, handleMessage };
}

function nigeriaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parsePassage(raw) {
  const parsed = parseJson(raw);
  const title = String(parsed.title || '').trim();
  const passage = String(parsed.passage || '').trim();
  if (!title || !passage) throw new Error('The AI could not create a reading passage.');
  return { title, passage };
}

function parseCoachResponse(raw) {
  const parsed = parseJson(raw);
  return {
    kind: parsed.kind === 'reading' ? 'reading' : 'answer',
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
    transcription: String(parsed.transcription || '').trim(),
    feedback: String(parsed.feedback || '').trim(),
    answer: String(parsed.answer || '').trim(),
  };
}

function parseJson(raw) {
  return JSON.parse(String(raw || '').replace(/```json|```/gi, '').trim());
}

module.exports = { createReadingCoachService, nigeriaDate };
