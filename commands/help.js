const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { getAvailableSubjects } = require('../services/questionService');
const { studyMembers } = require('../config/members');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'studypal-logo.jpeg');

async function handleHelpCommand({ message, prefix }) {
  const subjects = getAvailableSubjects().join(', ');
  const memberLines = studyMembers.map((member) => {
    return `- ${member.name}: ${member.subjects.join(' and ')}`;
  });

  const helpText = [
    '🤖 *StudyPal* — _Study. Practice. Improve._',
    '',
    '*Quiz Commands*',
    `${prefix}help - Show this help message`,
    `${prefix}quiz <subject> [topic] - Start a timed quiz. Subjects: ${subjects}`,
    `${prefix}leaderboard - Show total points`,
    `${prefix}attendance - Show recent participation`,
    `${prefix}score - Show your score`,
    `${prefix}stop - Stop the current quiz`,
    '',
    '*AI Learning Assistant*',
    'After each question, StudyPal explains the answer:',
    '- Right or wrong → a private explanation just for you, while the quiz keeps going for everyone else',
    '- Time runs out → the whole group sees the explanation together',
    '- Ask a follow-up ("explain more", "simplify", or any question) to keep learning',
    '- Reply *next* anytime to move on immediately',
    '',
    'Current study focus:',
    ...memberLines,
    '',
    'Examples:',
    `${prefix}quiz biology`,
    `${prefix}quiz physics`,
    `${prefix}quiz mathematics`,
  ].join('\n');

  try {
    const media = MessageMedia.fromFilePath(LOGO_PATH);
    await message.reply(media, undefined, { caption: helpText });
  } catch (error) {
    // Never let a missing/unreadable logo file break the help command —
    // fall back to text-only.
    await message.reply(helpText);
  }
}

module.exports = { handleHelpCommand };