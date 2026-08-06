const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { getAvailableSubjects } = require('../services/questionService');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'studypal-logo.jpeg');

async function handleHelpCommand({ message, prefix }) {
  const subjects = getAvailableSubjects().join(', ');

  const helpText = [
    '*StudyPal* - _Study. Practice. Improve._',
    '',
    '*Community Group*',
    'Use the group for questions, discussion, announcements, study tips, motivation, and optional challenges.',
    'Quizzes and progress tracking happen privately in your DM with StudyPal.',
    '',
    '*Private Tutor Commands*',
    `${prefix}quiz <subject> [topic] - Start a private quiz. Subjects: ${subjects}`,
    `${prefix}history - Review completed quizzes`,
    `${prefix}stats - View personal statistics`,
    `${prefix}score - View your score summary`,
    `${prefix}goal [questions] - View or set your daily goal`,
    `${prefix}streak - View your study streak`,
    `${prefix}badges - View achievements`,
    `${prefix}review - Review recent wrong answers`,
    `${prefix}report - View your weekly report`,
    `${prefix}plan - View your StudyPal profile and subscription`,
    `${prefix}upgrade - View Premium subscription options`,
    `${prefix}stop - Stop the current quiz`,
    '',
    '*Premium Commands*',
    `${prefix}analytics - Advanced performance analytics`,
    `${prefix}recommend - Personalized study recommendation`,
    '',
    '*AI Tutor*',
    'After each question, StudyPal explains why the correct option is right, why the wrong options are wrong, and gives a memory tip.',
    'You can also chat naturally in DM: explain this like I am 10, give another example, give me a mnemonic, test me again, or make it harder.',
    '',
    '*Community Commands*',
    `${prefix}help - Show this help message`,
    `${prefix}leaderboard - Show optional community points`,
    `${prefix}attendance - Show recent participation`,
    '',
    'Examples:',
    `${prefix}quiz biology`,
    `${prefix}quiz physics electricity`,
    `${prefix}goal 20`,
  ].join('\n');

  try {
    const media = MessageMedia.fromFilePath(LOGO_PATH);
    await message.reply(media, undefined, { caption: helpText });
  } catch (error) {
    await message.reply(helpText);
  }
}

module.exports = { handleHelpCommand };
