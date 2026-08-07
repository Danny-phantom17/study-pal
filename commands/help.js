const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { getAvailableSubjects } = require('../services/questionService');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'studypal-logo.jpeg');

async function handleHelpCommand({ message, prefix }) {
  const subjects = getAvailableSubjects().join(', ');

  const helpText = [
    '*StudyPal* - _Study. Practice. Improve._',
    'Your personal JAMB AI tutor on WhatsApp.',
    '',
    '*How StudyPal Works*',
    'Community group: ask questions, discuss topics, receive announcements, study tips, motivation, and challenges.',
    'Private DM: take quizzes, see scores, track progress, review answers, and chat with your AI tutor.',
    'Your quiz history, scores, stats, streaks, and explanations stay private.',
    '',
    '*Free Access*',
    '- New users get a 7-day trial: 20 questions/day, 2 subjects/day, AI enabled',
    '- After trial: 5 questions/day, all subjects, limited AI',
    '- Quiz history and personal statistics',
    '- Study streak, daily goals, weekly reports, and badges',
    '- StudyPal Community access',
    '',
    '*Premium / VIP / Admin / Owner Access*',
    'Price: \u20A63,000',
    '- Unlimited questions',
    '- Unlimited subjects',
    '- Unlimited AI Tutor messages and explanations',
    '- Unlimited follow-up questions',
    '',
    '*Upgrade Payment*',
    'Bank Name: PalmPay',
    'Account Name: Daniel Godwin Effiong',
    'Account Number: 7044438532',
    'Type subscribe to view payment instructions.',
    'After payment, type payment and answer the text verification questions.',
    'No screenshot or receipt upload is required.',
    '',
    '*Student Commands*',
    `${prefix}quiz <subject> [topic] - Start a private quiz. Subjects: ${subjects}`,
    `${prefix}history - Review completed quizzes`,
    `${prefix}stats - View personal statistics`,
    `${prefix}score - View your score summary`,
    `${prefix}goal [questions] - View or set your daily goal`,
    `${prefix}streak - View your study streak`,
    `${prefix}badges - View achievements`,
    `${prefix}review - Review recent wrong answers`,
    `${prefix}report - View your weekly report`,
    `${prefix}plan - View current plan, expiry, remaining questions, and AI access`,
    'subscribe - View Premium price and bank details',
    'payment - Submit bank name, amount paid, and account last 4 digits',
    `${prefix}analytics - Premium advanced performance analytics`,
    `${prefix}recommend - Premium personalized study recommendation`,
    `${prefix}stop - Stop the current quiz`,
    '',
    '*AI Tutor*',
    'After each question, StudyPal explains why the correct option is right, why the wrong options are wrong, and gives a memory tip.',
    'In DM, you can also say: explain this like I am 10, give another example, give me a mnemonic, test me again, or make it harder.',
    '',
    '*Community Commands*',
    `${prefix}help - Show this guide`,
    `${prefix}leaderboard - Show optional community points`,
    `${prefix}attendance - Show recent participation`,
    '',
    '*Admin / Owner Commands*',
    `${prefix}dashboard - View pending subscription requests`,
    `${prefix}approvepremium <requestId> [days] - Approve a pending subscription`,
    `${prefix}rejectpayment <requestId> [reason] - Reject a pending subscription`,
    `${prefix}adminplan <phone> <free|premium> [YYYY-MM-DD] - Manually update a plan`,
    `${prefix}adminrole <phone> <student|admin|vip> [name] - Update a role`,
    '',
    '*Examples*',
    `${prefix}quiz biology`,
    `${prefix}quiz physics electricity`,
    `${prefix}goal 20`,
    'subscribe',
    'payment',
    `${prefix}dashboard`,
  ].join('\n');

  try {
    const media = MessageMedia.fromFilePath(LOGO_PATH);
    await message.reply(media, undefined, { caption: helpText });
  } catch (error) {
    await message.reply(helpText);
  }
}

module.exports = { handleHelpCommand };
