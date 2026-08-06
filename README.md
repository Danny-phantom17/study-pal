# StudyPal v2

StudyPal is an AI-powered personal study tutor for WAEC and JAMB students on WhatsApp. It helps students practise exam-style questions, receive Gemini AI explanations, track progress, review weak areas, and build consistent study habits.

## Product Model

StudyPal has two environments:

- StudyPal Community: the WhatsApp group for educational questions, peer discussion, announcements, daily study tips, motivation, and optional challenges.
- StudyPal Private Chat: the student's personal tutor space for quizzes, scores, progress, statistics, achievements, streaks, wrong-answer review, and AI explanations.

Quizzes are not run in the group. If a student sends `!quiz` in a group, StudyPal redirects them to DM so their learning record stays private.

## Features

- Private WAEC/JAMB-style quizzes from JSON question banks
- Gemini explanations after every question
- Explanation of why the correct option is correct and why wrong options are wrong
- Memory tips and natural follow-up tutoring
- Quiz history and per-session summaries
- Personal statistics and subject progress comparison
- Daily goals and study streaks
- Achievement badges
- Free/Premium subscription profiles linked to WhatsApp numbers
- Weekly reports
- Wrong-answer review
- Optional Google Sheets integration for legacy points, attendance, and sheet-hosted questions
- Render Background Worker deployment with persistent disk support

## Commands

Private chat:

```text
!quiz <subject> [topic]
!history
!stats
!score
!goal [questions]
!streak
!badges
!review
!report
!plan
!upgrade
!stop
```

Premium private chat:

```text
!analytics
!recommend
```

Community group:

```text
!help
!leaderboard
!attendance
```

Students can also chat naturally in DM:

```text
Explain this like I am 10.
Give another example.
Give me a mnemonic.
Test me again.
Make the questions harder.
```

## Install

```bash
npm install
```

StudyPal requires Node.js `>=22.5.0 <25.0.0` because it uses Node's built-in `node:sqlite` module. The repo includes `.node-version` set to `22.22.0`.

## Configure

Copy `.env.example` to `.env` and fill in at least:

```env
GEMINI_API_KEY=your_gemini_api_key_here
BOT_COMMAND_PREFIX=!
QUIZ_QUESTION_COUNT=20
QUIZ_TIME_LIMIT_SECONDS=30
POINTS_PER_CORRECT_ANSWER=10
WWEBJS_AUTH_DIR=.wwebjs_auth
STUDYPAL_DB_PATH=data/studypal.db
FREE_DAILY_QUIZ_LIMIT=3
FREE_FOLLOWUPS_PER_QUESTION=3
FREE_REVIEW_LIMIT=5
```

Optional group reminders:

```env
STUDY_GROUP_CHAT_ID=your_group_chat_id@g.us
ADMIN_WHATSAPP_NUMBER=234...
REMINDER_START_HOUR=14
```

The same `ADMIN_WHATSAPP_NUMBER` is used for manual subscription activation.

## Subscription System

Every WhatsApp number gets a StudyPal profile with:

- Name
- Phone number
- User role
- Subscription plan
- Subscription expiry date
- Quiz history
- Statistics
- Study streak
- Achievements

Free includes up to 2 quiz sessions per day, AI explanations for every answered question, quiz history, personal statistics, study streaks, daily goals, weekly reports, community access, and achievement badges.

Premium adds unlimited quiz sessions, unlimited AI follow-up questions, unlimited review of previous quizzes, personalized recommendations, advanced analytics, priority AI response during busy periods, and early access to new features.

Owner, Admin, and VIP users always receive unrestricted Premium-level access. They are never affected by Free quiz limits, AI follow-up limits, review limits, or future usage restrictions.

Seeded Owner:

```text
Danny - +2347044438532
```

Seeded VIP users:

```text
Shedrach - +2349031103913
Claudia - +2347060582146
Vivian - +2348130351163
```

When a Free student reaches the daily quiz limit, StudyPal asks whether they want to upgrade. If they answer `1` or `Yes`, StudyPal shows subscription plans and payment instructions. If they answer `2` or `No`, StudyPal returns them to the main menu and reminds them they can still review quizzes, read explanations, check statistics, and participate in the community. Free quiz sessions reset automatically the following day.

Students can view their plan with:

```text
!plan
```

They can view upgrade instructions with:

```text
!upgrade
```

or by replying:

```text
UPGRADE
```

After payment confirmation, the admin can activate Premium manually:

```text
!adminplan 2348012345678 premium 2026-09-06
```

To return a student to Free:

```text
!adminplan 2348012345678 free
```

Admins can be added or removed from the database without changing code. VIP users can also be added or removed this way:

```text
!adminrole 2348012345678 admin Student Name
!adminrole 2348012345678 vip Student Name
!adminrole 2348012345678 student Student Name
```

The owner role cannot be removed or assigned through chat commands.

Premium payment details shown to students:

```text
Payment Platform: PalmPay
Account Name: Daniel Godwin Effiong
Account Number: 7044438532
```

After payment, the student should send the payment receipt or transaction reference for verification. Once confirmed, use `!adminplan` to update the account from Free to Premium, set the subscription expiry date, unlock all Premium features immediately, and save the subscription status in SQLite.

Optional Google Sheets via Apps Script:

```env
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/your-deployment-id/exec
```

Optional service-account Google Sheets:

```env
GOOGLE_SPREADSHEET_ID=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

## Check Setup

```bash
npm run setup:check
npm run check
```

`setup:check` requires Gemini, Node 22.5+, and a local JSON question bank. Google Sheets and internet lookup are optional.

## Run Locally

```bash
npm start
```

When the QR code appears, open WhatsApp, go to Linked devices, and scan the code.

## Question Bank

Subject files live in `data/` as JSON arrays. Each question should follow this shape:

```json
{
  "id": "biology-001",
  "question": "Which cell organelle is known as the powerhouse of the cell?",
  "options": ["Nucleus", "Mitochondrion", "Ribosome", "Golgi body"],
  "answer": "B",
  "acceptedAnswers": ["mitochondrion", "mitochondria"]
}
```

AI explains questions, but the question bank remains the source of truth.

## Deploy To Render

This repo includes `render.yaml` for a Render Background Worker.

1. Push `study-bot/` to GitHub as the repo root, or set the Render root directory to `study-bot`.
2. In Render, create a Blueprint from `render.yaml`, or create a Background Worker manually.
3. Use:

```bash
Build command: npm install
Start command: npm start
```

4. Set secret environment variables in Render:

```env
GEMINI_API_KEY=...
APPS_SCRIPT_WEB_APP_URL=...
STUDY_GROUP_CHAT_ID=...
ADMIN_WHATSAPP_NUMBER=...
```

5. Keep these disk-backed values from `render.yaml`:

```env
WWEBJS_AUTH_DIR=/var/data/studypal/.wwebjs_auth
STUDYPAL_DB_PATH=/var/data/studypal/studypal.db
```

6. Deploy and scan the WhatsApp QR code from Render logs.

Render free instances do not support background workers. Use at least the Starter plan and attach the persistent disk so WhatsApp auth and the SQLite learning history survive deploys and restarts.

## Notes

- WhatsApp Web automation depends on a stable linked-device session.
- For long-running production use, monitor Render logs after deploys and WhatsApp reconnects.
- If Puppeteer/Chromium fails on Render, keep `PUPPETEER_HEADLESS=true` and check the Render build logs for browser install issues.
