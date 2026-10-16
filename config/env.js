require('dotenv').config();

const { z } = require('zod');

function numericValue(defaultValue, options = {}) {
  const {
    integer = false,
    minimum,
    maximum,
    positive = false,
  } = options;

  let schema = z.number().finite();

  if (integer) schema = schema.int();
  if (positive) schema = schema.positive();
  if (minimum !== undefined) schema = schema.min(minimum);
  if (maximum !== undefined) schema = schema.max(maximum);

  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }, schema.default(defaultValue));
}

const optionalString = z.preprocess((value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}, z.string());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: numericValue(3000, { integer: true, minimum: 1, maximum: 65535 }),
  COMMAND_PREFIX: z.string().trim().min(1).max(3).default('!'),

  GEMINI_API_KEY: optionalString,

  STUDYPAL_DB_PATH: z.string().trim().min(1).default('./data/studypal.db'),

  STUDY_GROUP_CHAT_ID: optionalString,
  ADMIN_WHATSAPP_NUMBER: optionalString,
  OWNER_WHATSAPP_NUMBER: optionalString,
  READING_COACH_PHONE_NUMBER: optionalString,

  BANK_NAME: optionalString,
  BANK_ACCOUNT_NAME: optionalString,
  BANK_ACCOUNT_NUMBER: optionalString,
  PREMIUM_PRICE: numericValue(3000, { minimum: 0 }),

  REMINDER_START_HOUR: numericValue(21, { integer: true, minimum: 0, maximum: 23 }),
  QUIZ_TIME_LIMIT_SECONDS: numericValue(30, { integer: true, positive: true }),
  QUIZ_QUESTION_COUNT: numericValue(20, { integer: true, positive: true }),
  POINTS_PER_CORRECT_ANSWER: numericValue(1.67, { positive: true }),
  MAX_ATTEMPTS_PER_QUESTION: numericValue(2, { integer: true, positive: true }),

  FREE_DAILY_QUESTIONS: numericValue(5, { integer: true, minimum: 0 }),
  FREE_DAILY_AI_MESSAGES: numericValue(5, { integer: true, minimum: 0 }),
  FREE_TRIAL_DAYS: numericValue(7, { integer: true, minimum: 0 }),
  FREE_TRIAL_DAILY_QUESTIONS: numericValue(20, { integer: true, minimum: 0 }),
  FREE_TRIAL_DAILY_SUBJECTS: numericValue(2, { integer: true, minimum: 0 }),

  JWT_SECRET: optionalString,
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && !config.GEMINI_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['GEMINI_API_KEY'],
      message: 'Required in production',
    });
  }

  if (
    config.NODE_ENV === 'production'
    && config.JWT_SECRET
    && config.JWT_SECRET.length < 32
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: 'Must contain at least 32 characters in production',
    });
  }
});

function loadConfig(environment = process.env) {
  const result = envSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.length ? issue.path.join('.') : 'environment';
        return `- ${field}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = result.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    commandPrefix: env.COMMAND_PREFIX,
    geminiApiKey: env.GEMINI_API_KEY,
    database: {
      path: env.STUDYPAL_DB_PATH,
    },
    whatsapp: {
      studyGroupChatId: env.STUDY_GROUP_CHAT_ID,
      adminNumber: env.ADMIN_WHATSAPP_NUMBER,
      ownerNumber: env.OWNER_WHATSAPP_NUMBER,
      readingCoachPhoneNumber: env.READING_COACH_PHONE_NUMBER,
    },
    payment: {
      bankName: env.BANK_NAME,
      accountName: env.BANK_ACCOUNT_NAME,
      accountNumber: env.BANK_ACCOUNT_NUMBER,
      premiumPrice: env.PREMIUM_PRICE,
    },
    quiz: {
      reminderStartHour: env.REMINDER_START_HOUR,
      timeLimitSeconds: env.QUIZ_TIME_LIMIT_SECONDS,
      questionCount: env.QUIZ_QUESTION_COUNT,
      pointsPerCorrectAnswer: env.POINTS_PER_CORRECT_ANSWER,
      maxAttemptsPerQuestion: env.MAX_ATTEMPTS_PER_QUESTION,
    },
    limits: {
      freeDailyQuestions: env.FREE_DAILY_QUESTIONS,
      freeDailyAiMessages: env.FREE_DAILY_AI_MESSAGES,
      trialDays: env.FREE_TRIAL_DAYS,
      trialDailyQuestions: env.FREE_TRIAL_DAILY_QUESTIONS,
      trialDailySubjects: env.FREE_TRIAL_DAILY_SUBJECTS,
    },
    jwtSecret: env.JWT_SECRET,
  };
}

let cachedConfig;

function getConfig() {
  if (!cachedConfig) {
    cachedConfig = loadConfig(process.env);
  }

  return cachedConfig;
}

module.exports = {
  envSchema,
  loadConfig,
  getConfig,
};
