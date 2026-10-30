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
- Two private-chat AI roles: StudyPal tutor and ShedShare customer-service secretary
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
subscribe
payment
!stop
```

Premium private chat:

```text
!analytics
!recommend
```

Admin / owner:

```text
!dashboard
!approvepremium <requestId> [days]
!rejectpayment <requestId> [reason]
!adminplan <phone> <free|premium> [YYYY-MM-DD]
!adminrole <phone> <student|admin|vip> [name]
!lister <phone> | <name> | <location>
!renter <phone> | <name> | <location>
```

The ShedShare outreach commands are private-chat owner commands. `!lister` sends the supplier invitation and stores the contact role/name/location; `!renter` sends the customer invitation. The owner can enter either command in the StudyPal self-chat; StudyPal handles the prospect's replies and scheduled follow-up. `!account` (or `!accounts`) lists saved and recognized ShedShare outreach chats with the contact's number, name, lead type, area, and an AI summary of their reply and interest level. A contact with no reply is marked `Unknown` / `No reply yet`.

The owner can add future business profiles directly in the WhatsApp self-chat without editing code. Send `!business help` for the format. Each profile stores its business name, description, offerings, intended customers, interaction rules, follow-up interval, and maximum number of follow-ups in SQLite. `!business list`, `!business show <key>`, and `!business accounts <key>` manage and inspect them. `!outreach <key> | <phone> | <name> | <location>` starts a customized conversation; subsequent replies use only that profile, and scheduled follow-ups obey its configured interval/count. Re-adding a key updates the profile; setting max follow-ups to 0 disables them. These profiles are private owner-managed records; customer chats only receive business information needed for that business's conversation.

The owner can also send an exact message to a list of saved or unsaved WhatsApp numbers with `!sendlist <number1, number2, ...> | <message>`. Numbers are normalized, deduplicated, and limited to 100 per command. Sends are paced, and the bot replies with success and failure counts.

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

For ordinary private messages, Gemini routes explicit study requests to the StudyPal tutor and ShedShare marketplace questions to the customer-service secretary. If the intent is unclear, the bot asks which kind of help is needed. StudyPal commands and active quiz flows keep their existing handling. ShedShare answers use the product guidance in `services/ai/shedShareService.js`; the bot does not have live access to listings or bookings, so the website and booking screens remain authoritative for current availability, prices, and payment status.

At 10:00 Africa/Lagos daily, StudyPal reviews direct one-to-one WhatsApp chats, including unsaved phone-number chats. It considers a single follow-up only when the last outgoing message is at least 3 days old and the conversation clearly expects an answer or next step, with no later reply, refusal, or completed exchange. It sends at most one follow-up per chat and no more than 10 per day. Groups and status chats are excluded; follow-up state is stored in SQLite.

Gemini is the default AI provider. To switch providers later, set `AI_PROVIDER=openai`, add `OPENAI_API_KEY`, choose an `OPENAI_MODEL`, and restart. The OpenAI adapter uses the Responses API for text/images and the audio transcription endpoint for voice notes; see OpenAI's [Responses API](https://platform.openai.com/docs/api-reference/responses) and [speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text).

## Install

```bash
npm install
```

StudyPal requires Node.js `>=22.5.0 <25.0.0` because it uses Node's built-in `node:sqlite` module. The repo includes `.node-version` set to `22.22.0`.

## Configure

Copy `.env.example` to `.env` and fill in at least:

```env
GEMINI_API_KEY=your_gemini_api_key_here
COMMAND_PREFIX=!
QUIZ_QUESTION_COUNT=20
QUIZ_TIME_LIMIT_SECONDS=30
POINTS_PER_CORRECT_ANSWER=1.67
WWEBJS_AUTH_DIR=.wwebjs_auth
STUDYPAL_DB_PATH=data/studypal.db
FREE_DAILY_QUESTIONS=5
FREE_FOLLOWUPS_PER_QUESTION=3
FREE_REVIEW_LIMIT=5
FREE_DAILY_AI_MESSAGES=10
FREE_TRIAL_DAYS=7
FREE_TRIAL_DAILY_QUESTIONS=20
FREE_TRIAL_DAILY_SUBJECTS=2
FREE_TRIAL_DAILY_AI_MESSAGES=20
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

New users receive a 7-day free trial with 20 questions per day, up to 2 subjects per day, and AI explanations enabled.

After the trial, Free includes 5 questions per day, access to all subjects, limited AI tutor access, quiz history, personal statistics, study streaks, daily goals, weekly reports, community access, and achievement badges.

Premium adds unlimited questions, unlimited subjects, unlimited AI tutor messages and explanations, unlimited follow-up questions, personalized recommendations, and advanced analytics.

Owner, Admin, VIP, and Premium users always receive unrestricted access. They are never affected by Free or Trial question limits, subject limits, AI limits, or future usage restrictions.

Owner and VIP phone profiles are seeded by the application. Do not commit live database files or credentials.

When a student reaches a daily question or subject limit, StudyPal explains the limit and shows how to upgrade. If they answer `1` or `Yes` to an upgrade prompt, StudyPal shows subscription plans and payment instructions. If they answer `2` or `No`, StudyPal returns them to the main menu and reminds them they can still review quizzes, read explanations, check statistics, and participate in the community. Free and Trial limits reset automatically the following day.

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

Premium payment details shown to students come from `BANK_NAME`, `BANK_ACCOUNT_NAME`, and `BANK_ACCOUNT_NUMBER`. Configure these privately in Render before enabling paid subscriptions.

Students type `subscribe` to view the payment details. After payment, they type `payment` and answer:

```text
Bank name
Amount paid
Last 4 digits of the account used for payment
```

No screenshot or receipt upload is required. The request appears in the Admin Dashboard as Pending:

```text
!dashboard
```

Approve or reject from the dashboard:

```text
!approvepremium <requestId> [days]
!rejectpayment <requestId> [reason]
```

When approved, StudyPal activates Premium immediately, calculates and stores the expiry date, unlocks unlimited questions, unlimited subjects, and unlimited AI access, and saves the subscription status in SQLite.

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
For local use, `PUPPETEER_HEADLESS=false` opens the actual WhatsApp Web session used by StudyPal in a visible Chrome window, alongside the local connection-status page. That Chrome window uses StudyPal's saved session, so it can reconnect without another scan when the session is still valid. The status page shows a QR code only if WhatsApp requests a new link. Keep `PUPPETEER_HEADLESS=true` on servers without a display, such as Render. Replies are sent without marking the chat as seen.

For the private reading coach, set `READING_COACH_PHONE_NUMBER` to the learner’s WhatsApp number in `.env` or the Render environment. That number can send `coach` in a private chat to get the day’s reading passage, send a voice note reading it for a saved score, or send an assignment photo for help. The coach command is private and is not listed in `help`. A new daily passage is sent when the learner asks for `coach` that day.

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

1. Connect this repository to Render and create a Blueprint from the `render.yaml` at the repository root.
2. Fill the prompted values in Render, including the Gemini key, WhatsApp admin/group settings, and bank details used for Premium payments.
3. The Blueprint builds the included Dockerfile so Chromium's Linux libraries are available to WhatsApp Web. The image runs:

```bash
Dockerfile: ./Dockerfile
Container command: npm start
```

4. Set or verify these environment variables in Render:

```env
GEMINI_API_KEY=...
STUDY_GROUP_CHAT_ID=...
ADMIN_WHATSAPP_NUMBER=...
BANK_NAME=...
BANK_ACCOUNT_NAME=...
BANK_ACCOUNT_NUMBER=...
```

`APPS_SCRIPT_WEB_APP_URL` is optional. Leave it unset if you do not use Google Sheets.

5. Keep these disk-backed values from `render.yaml`:

```env
WEBJS_AUTH_DIR=/var/data/studypal/.wwebjs_auth
STUDYPAL_DB_PATH=/var/data/studypal/studypal.db
```

6. Deploy and link the WhatsApp device using the pairing method shown in Render logs.

Render free instances do not support background workers. Use at least the Starter plan and attach the persistent disk so WhatsApp auth and the SQLite learning history survive deploys and restarts.

## Notes

- WhatsApp Web automation depends on a stable linked-device session.
- For long-running production use, monitor Render logs after deploys and WhatsApp reconnects.
- If Puppeteer/Chromium fails on Render, keep `PUPPETEER_HEADLESS=true` and check the Render build logs for browser install issues.
