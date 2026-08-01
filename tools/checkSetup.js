require('dotenv').config();

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
    console.log(`${hasValue(key) ? 'OK ' : 'MISS'} ${key}`);
  });
}

reportGroup('Google Sheets - Apps Script', appsScriptGoogleSheets);
reportGroup('Google Sheets - Service Account', serviceAccountGoogleSheets);
reportGroup('Internet Question Lookup', optionalInternetLookup);

const sheetsReady = appsScriptGoogleSheets.every(hasValue) || serviceAccountGoogleSheets.every(hasValue);
const customApiReady = hasValue('JAMB_QUESTION_API_URL');
const googleSearchReady = hasValue('GOOGLE_SEARCH_API_KEY') && hasValue('GOOGLE_SEARCH_ENGINE_ID');

console.log('\nStatus');
console.log(`Google Sheets: ${sheetsReady ? 'ready' : 'not ready'}`);
console.log(`Internet lookup: ${customApiReady || googleSearchReady ? 'ready' : 'not ready'}`);

if (!sheetsReady || (!customApiReady && !googleSearchReady)) {
  process.exitCode = 1;
}
