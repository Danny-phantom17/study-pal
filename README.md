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
- AWS EC2 worker deployment with persistent EBS storage

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
COMMAND_PREFIX=!
QUIZ_QUESTION_COUNT=20
QUIZ_TIME_LIMIT_SECONDS=30
POINTS_PER_CORRECT_ANSWER=1.67
WEBJS_AUTH_DIR=.wwebjs_auth
STUDYPAL_DB_PATH=data/studypal.db
PUPPETEER_HEADLESS=true
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

Premium payment details shown to students come from `BANK_NAME`, `BANK_ACCOUNT_NAME`, and `BANK_ACCOUNT_NUMBER`. Configure these privately on the EC2 instance before enabling paid subscriptions.

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
The bot also opens a local browser page with the QR code automatically. This page uses a `127.0.0.1` address because it is served locally; it is not WhatsApp Web. After scanning, the page reports when the bot is connected. The bot runs WhatsApp in the background and does not open a separate WhatsApp Web window. Replies are sent without marking the chat as seen.

For the private reading coach, set `READING_COACH_PHONE_NUMBER` to the learner’s WhatsApp number in `.env`. That number can send `coach` in a private chat to get the day’s reading passage, send a voice note reading it for a saved score, or send an assignment photo for help. The coach command is private and is not listed in `help`. A new daily passage is sent when the learner asks for `coach` that day.

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

## Deploy To AWS EC2

StudyPal is a persistent WhatsApp worker. It does not need a public web domain or open application ports.

1. Launch a Linux EC2 instance and attach a separate encrypted EBS data volume. Set the data volume to persist when the instance is terminated. Attach and mount that volume at `/mnt/studypal`, and configure it to mount by UUID after each reboot. Follow the [AWS EBS volume setup guide](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-using-volumes.html); format only a new, empty volume.
2. In the instance security group, allow SSH only from your own IP address. Keep outbound internet access available for WhatsApp and Gemini; do not open inbound application ports.
3. Install Docker on the instance. On Amazon Linux 2023, run:

```bash
sudo yum update -y
sudo yum install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
```

Reconnect your SSH session after adding the user to the Docker group.
4. Clone this repository, create `.env` from `.env.example`, and fill in the variables below. Keep `.env` private and set its permissions to owner-only.

```env
NODE_ENV=production
GEMINI_API_KEY=...
COMMAND_PREFIX=!
PUPPETEER_HEADLESS=true
WEBJS_CLEAR_CHROMIUM_LOCKS=true
WEBJS_AUTH_DIR=/data/.wwebjs_auth
STUDYPAL_DB_PATH=/data/studypal.db
WEBJS_PAIRING_PHONE_NUMBER=234...
STUDY_GROUP_CHAT_ID=...
ADMIN_WHATSAPP_NUMBER=...
BANK_NAME=...
BANK_ACCOUNT_NAME=...
BANK_ACCOUNT_NUMBER=...
PREMIUM_PRICE=3000
```

`STUDY_GROUP_CHAT_ID`, `ADMIN_WHATSAPP_NUMBER`, the bank fields, and `WEBJS_PAIRING_PHONE_NUMBER` can be left unset if you do not use those features. `APPS_SCRIPT_WEB_APP_URL` and service-account Google Sheets credentials are optional. The pairing phone number is international digits without `+`.

5. Build and start the single worker from the repository root:

```bash
docker build -t studypal .
docker run -d --name studypal --restart unless-stopped --init --env-file .env \
  --volume /mnt/studypal:/data \
  --env WEBJS_AUTH_DIR=/data/.wwebjs_auth \
  --env STUDYPAL_DB_PATH=/data/studypal.db \
  studypal
docker logs -f studypal
```

The Dockerfile installs Chrome's Linux runtime libraries and runs `npm ci`; the package `postinstall` installs the matching Chrome browser. For first-time WhatsApp linking, use the pairing code printed in the container logs. The Docker restart policy brings the worker back after host reboots, and the mounted EBS volume retains the SQLite database and WhatsApp session.

Keep this as a single worker because StudyPal uses one WhatsApp session and a local SQLite database. Configure EBS snapshots for backups. If you need existing study records, stop the local bot and make a consistent SQLite backup before copying it to `/mnt/studypal`; do not copy a live database's `-wal` or `-shm` sidecars separately.

## Notes

- WhatsApp Web automation depends on a stable linked-device session.
- For long-running production use, monitor the Docker logs after deploys and WhatsApp reconnects.
- If Puppeteer/Chromium fails, keep `PUPPETEER_HEADLESS=true` and check the deployment logs for browser installation issues.
