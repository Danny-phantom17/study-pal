require('dotenv').config();

const fs = require('fs');
const path = require('path');

const serviceAccountGoogleSheets = [
  'GOOGLE_SPREADSHEET_ID',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
];

const appsScriptGoogleSheets = [
  'APPS_SCRIPT_WEB_APP_URL',
];

const optionalInternetLookup = [
  'JAMB_QUESTION_API_URL',
  'GOOGLE_SEARCH_API_KEY',
  'GOOGLE_SEARCH_ENGINE_ID',
];

function hasValue(key) {
  return Boolean(String(process.env[key] || '').trim());
}

function reportGroup(title, keys) {
  console.log(`\n${title}`);
  keys.forEach((key) => {
    console.log(`${hasValue(key) ? 'OK  ' : 'MISS'} ${key}`);
  });
}

function nodeReady() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 5);
}

function localQuestionBankReady() {
  const dataDir = path.join(__dirname, '..', 'data');
  return fs.existsSync(dataDir) && fs.readdirSync(dataDir).some((file) => file.endsWith('.json'));
}

reportGroup('Required AI Tutor', ['GEMINI_API_KEY']);
reportGroup('Google Sheets - Apps Script (optional)', appsScriptGoogleSheets);
reportGroup('Google Sheets - Service Account (optional)', serviceAccountGoogleSheets);
reportGroup('Internet Question Lookup (optional)', optionalInternetLookup);
reportGroup('WhatsApp / Render Persistence', ['WWEBJS_AUTH_DIR', 'STUDYPAL_DB_PATH']);
reportGroup('Subscription Limits', ['FREE_DAILY_QUIZ_LIMIT', 'FREE_FOLLOWUPS_PER_QUESTION', 'FREE_REVIEW_LIMIT']);

const sheetsReady = appsScriptGoogleSheets.every(hasValue) || serviceAccountGoogleSheets.every(hasValue);
const customApiReady = hasValue('JAMB_QUESTION_API_URL');
const googleSearchReady = hasValue('GOOGLE_SEARCH_API_KEY') && hasValue('GOOGLE_SEARCH_ENGINE_ID');
const ready = hasValue('GEMINI_API_KEY') && nodeReady() && localQuestionBankReady();

console.log('\nStatus');
console.log(`Node ${process.versions.node}: ${nodeReady() ? 'ready' : 'requires >=22.5.0'}`);
console.log(`Gemini: ${hasValue('GEMINI_API_KEY') ? 'ready' : 'missing'}`);
console.log(`Local question bank: ${localQuestionBankReady() ? 'ready' : 'missing'}`);
console.log(`Google Sheets: ${sheetsReady ? 'ready' : 'optional/not configured'}`);
console.log(`Internet lookup: ${customApiReady || googleSearchReady ? 'ready' : 'optional/not configured'}`);

if (!ready) {
  process.exitCode = 1;
}
