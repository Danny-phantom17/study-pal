const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/**
 * Creates a Gemini-backed AI provider. Swap this file out (keeping the same
 * generateCompletion signature) to switch providers without touching any
 * calling code — tutorService and everything above it only knows this shape.
 *
 * @param {string} apiKey - GEMINI_API_KEY
 * @param {string} [model] - defaults to a cheap/fast, currently-available Gemini model
 */
function createGeminiProvider({ apiKey, model = DEFAULT_MODEL } = {}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to create the AI provider.');
  }

  async function generateCompletion({ systemPrompt, userPrompt }) {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await callGemini({ apiKey, model, systemPrompt, userPrompt });
      } catch (error) {
        lastError = error;

        // Only retry on transient overload (503) — anything else (bad key,
        // bad request, model not found) will just fail the same way again.
        if (error.status === 503 && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  return { generateCompletion };
}

async function callGemini({ apiKey, model, systemPrompt, userPrompt }) {
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Gemini API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API returned no text content.');
  }

  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { createGeminiProvider };