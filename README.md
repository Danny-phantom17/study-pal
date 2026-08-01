# WhatsApp Study Group Bot

A modular Node.js bot for WhatsApp study groups. It uses `whatsapp-web.js` for WhatsApp, `qrcode-terminal` for login, `dotenv` for configuration, and Google Sheets or Apps Script for scores and attendance.

## Features

- WhatsApp QR code authentication
- Commands: `!help`, `!quiz`, `!leaderboard`, `!attendance`, `!score`
- Topic-based JAMB-style internet question lookup for 50-question quizzes
- Subject question files in `data/` as a fallback
- Timed quizzes with one question at a time
- Automatic answer checking and point awards
- Duplicate scoring prevention per user per question
- Attendance logging whenever a member participates
- Google Sheets persistence for scores and attendance
- Console logging and guarded error handling

## Study Members

- Daniel: English and Physics
- Vivian: Chemistry
- Claudia: Biology
- Shedrach: Geography and Mathematics

The bot also supports new people joining the group automatically. It records participants by WhatsApp user ID and display name, so you do not need to hard-code future members.

## Install Dependencies

```bash
cd study-bot
npm install
```

## Configure Google Sheets With Apps Script

This is the easiest no-card setup.

1. Open your Google Sheet.
2. Go to `Extensions > Apps Script`.
3. Replace your current `Code.gs` with the code in:
   `docs/apps-script/Code.gs`
4. Make sure `SPREADSHEET_ID` at the top of `Code.gs` is your Google Sheet ID.
5. Click Save.
6. Click `Deploy > New deployment`.
7. Choose `Web app`.
8. Set `Execute as` to `Me`.
9. Set `Who has access` to `Anyone`.
10. Deploy and authorize it.
11. Copy the Web App URL.
12. Put it in `.env`:

```env
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/your-deployment-id/exec
```

Run this to check the setup:

```bash
npm run setup:check
```

The Apps Script creates three tabs automatically if they do not already exist:

- `Scores`
- `Attendance`
- `Questions`

## Optional Service Account Setup

You can skip this if you are using Apps Script.

If you later want the direct Google Sheets API setup, fill in:

```env
GOOGLE_SPREADSHEET_ID=your_google_sheet_id_here
GOOGLE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
```

The `Questions` tab can be used as a manual question bank. Use these columns:

```text
Subject | Topic | Question ID | Question | Option A | Option B | Option C | Option D | Answer | Accepted Answers
```

Example row:

```text
biology | respiration | biology-respiration-001 | Which organelle releases energy during respiration? | Nucleus | Mitochondrion | Ribosome | Vacuole | B | mitochondrion, mitochondria
```

Do not put questions in `config/members.js`; that file is only for student names and subject focus.

## Configure Internet JAMB Question Lookup

For best results, use your own trusted JAMB question API and set:

```env
JAMB_QUESTION_API_URL=https://your-api.example.com/questions
```

The API should accept `subject`, `topic`, and `limit` query parameters and return either an array or an object with a `questions` array:

```json
{
  "questions": [
    {
      "question": "Which instrument measures atmospheric pressure?",
      "options": ["Thermometer", "Barometer", "Hygrometer", "Anemometer"],
      "answer": "B"
    }
  ]
}
```

If you do not have a question API, the bot can use Google Programmable Search as a fallback:

```env
GOOGLE_SEARCH_API_KEY=your_google_search_api_key
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id
```

The search fallback looks for public JAMB past-question pages and extracts objective questions with answers. Public websites format questions differently, so a dedicated question API is more reliable.

## Start The Bot

```bash
npm start
```

When the QR code appears in the terminal:

1. Open WhatsApp on your phone.
2. Go to Linked devices.
3. Scan the QR code.
4. Add the bot account to your study group.

Try:

```text
!help
!quiz biology
!quiz physics electricity
!quiz geography climate
!quiz math algebra
!score
!leaderboard
!attendance
```

## Add Or Edit Questions

Each subject file in `data/` is a JSON array. Example:

```json
{
  "id": "biology-001",
  "question": "Which cell organelle is known as the powerhouse of the cell?",
  "options": ["Nucleus", "Mitochondrion", "Ribosome", "Golgi body"],
  "answer": "B",
  "acceptedAnswers": ["mitochondrion", "mitochondria"]
}
```

Users can answer with the option letter or any value in `acceptedAnswers`.

## Deploy To Render

WhatsApp Web bots need a persistent browser session. Render can run this as a Background Worker, but free instances may sleep and break the WhatsApp session.

1. Push this project to GitHub.
2. Create a new Render Background Worker.
3. Set the build command:

```bash
npm install
```

4. Set the start command:

```bash
npm start
```

5. Add environment variables from `.env.example` in Render.
6. Use a persistent disk for the WhatsApp session folder if your Render plan supports it.
7. Deploy and open the Render logs.
8. Scan the QR code from the logs.

If Puppeteer has Chromium issues on Render, set:

```env
PUPPETEER_HEADLESS=true
```

On Windows, you can use your installed Chrome instead of Puppeteer's downloaded browser:

```env
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

For long-running production use, a VPS is often more reliable because WhatsApp Web sessions depend on a stable browser profile.
