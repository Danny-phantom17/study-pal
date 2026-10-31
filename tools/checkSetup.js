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

function reportOptionalSetting(title, configured) {
  console.log(`${configured ? 'OK  ' : 'OK  (default)'} ${title}`);
}

function reportLimit(key, defaultValue) {
  const configuredValue = String(process.env[key] || '').trim();
  const value = configuredValue ? Number(configuredValue) : defaultValue;
  const isValid = Number.isFinite(value) && value >= 0;
  console.log(`${isValid ? 'OK  ' : 'FAIL'} ${key}: ${isValid ? value : 'must be a non-negative number'}${configuredValue ? '' : ' (default)'}`);
  return isValid;
}

function nodeReady() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 5);
}

function localQuestionBankReady() {
  const dataDir = path.join(__dirname, '..', 'data');
  return fs.existsSync(dataDir) && fs.readdirSync(dataDir).some((file) => file.endsWith('.json'));
}

const geminiConfigured = hasValue('GEMINI_API_KEY')
  || String(process.env.GEMINI_API_KEYS || '').split(',').some((key) => key.trim());
console.log(`\nRequired AI Tutor\n${geminiConfigured ? 'OK  ' : 'MISS'} GEMINI_API_KEY or GEMINI_API_KEYS`);
reportGroup('Google Sheets - Apps Script (optional)', appsScriptGoogleSheets);
reportGroup('Google Sheets - Service Account (optional)', serviceAccountGoogleSheets);
reportGroup('Internet Question Lookup (optional)', optionalInternetLookup);
console.log('\nWhatsApp / Persistent Storage');
reportOptionalSetting('WEBJS_AUTH_DIR', hasValue('WEBJS_AUTH_DIR') || hasValue('WWEBJS_AUTH_DIR'));
reportOptionalSetting('STUDYPAL_DB_PATH', hasValue('STUDYPAL_DB_PATH'));
reportOptionalSetting('WEBJS_CLEAR_CHROMIUM_LOCKS', hasValue('WEBJS_CLEAR_CHROMIUM_LOCKS'));
reportGroup('WhatsApp Pairing Code (optional)', ['WEBJS_PAIRING_PHONE_NUMBER']);
console.log('\nSubscription Limits');
const limitsValid = [
  reportLimit('FREE_DAILY_QUESTIONS', 5),
  reportLimit('FREE_DAILY_AI_MESSAGES', 10),
  reportLimit('FREE_FOLLOWUPS_PER_QUESTION', 3),
  reportLimit('FREE_REVIEW_LIMIT', 5),
  reportLimit('FREE_TRIAL_DAYS', 7),
  reportLimit('FREE_TRIAL_DAILY_QUESTIONS', 20),
  reportLimit('FREE_TRIAL_DAILY_SUBJECTS', 2),
  reportLimit('FREE_TRIAL_DAILY_AI_MESSAGES', 20),
].every(Boolean);

const sheetsReady = appsScriptGoogleSheets.every(hasValue) || serviceAccountGoogleSheets.every(hasValue);
const customApiReady = hasValue('JAMB_QUESTION_API_URL');
const googleSearchReady = hasValue('GOOGLE_SEARCH_API_KEY') && hasValue('GOOGLE_SEARCH_ENGINE_ID');
const ready = geminiConfigured && nodeReady() && localQuestionBankReady() && limitsValid;

console.log('\nStatus');
console.log(`Node ${process.versions.node}: ${nodeReady() ? 'ready' : 'requires >=22.5.0'}`);
console.log(`Gemini: ${geminiConfigured ? 'ready' : 'missing'}`);
console.log(`Local question bank: ${localQuestionBankReady() ? 'ready' : 'missing'}`);
console.log(`Google Sheets: ${sheetsReady ? 'ready' : 'optional/not configured'}`);
console.log(`Internet lookup: ${customApiReady || googleSearchReady ? 'ready' : 'optional/not configured'}`);

if (!ready) {
  process.exitCode = 1;
}
