const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
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

  async function generateCompletion({ systemPrompt, userPrompt, media = [] }) {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await callGemini({ apiKey, model, systemPrompt, userPrompt, media });
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

function createOpenAiProvider({ apiKey, model = DEFAULT_OPENAI_MODEL } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai.');

  async function generateCompletion({ systemPrompt, userPrompt, media = [] }) {
    let resolvedUserPrompt = userPrompt;
    const content = [{ type: 'input_text', text: userPrompt }];
    for (const item of media) {
      if (item.mimeType?.startsWith('image/')) {
        content.push({
          type: 'input_image',
          image_url: `data:${item.mimeType};base64,${item.data}`,
        });
      } else if (item.mimeType?.startsWith('audio/')) {
        const transcript = await transcribeAudio({ apiKey, item });
        resolvedUserPrompt += `\n\nWhatsApp voice note transcript: ${transcript}`;
        content[0].text = resolvedUserPrompt;
      } else {
        throw new Error(`OpenAI provider does not support the attachment type ${item.mimeType || 'unknown'}.`);
      }
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`OpenAI API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    const text = data?.output_text || data?.output
      ?.flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('\n');
    if (!text) throw new Error('OpenAI API returned no text content.');
    return text;
  }

  return { generateCompletion };
}

async function transcribeAudio({ apiKey, item }) {
  const mimeType = String(item.mimeType || '').split(';')[0].trim().toLowerCase();
  const extensions = {
    'audio/ogg': 'ogg',
    'audio/oga': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
  };
  const extension = extensions[mimeType];
  if (!extension) throw new Error(`OpenAI transcription does not support the audio type ${mimeType || 'unknown'}.`);

  const form = new FormData();
  form.append('model', 'gpt-transcribe');
  form.append('response_format', 'json');
  form.append('file', new Blob([Buffer.from(item.data, 'base64')], { type: mimeType }), `whatsapp-voice-note.${extension}`);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI transcription API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }
  const data = await response.json();
  if (!data?.text) throw new Error('OpenAI transcription API returned no transcript.');
  return String(data.text).trim();
}

function createAiProvider({ provider = 'gemini', geminiApiKey, openAiApiKey, openAiModel } = {}) {
  if (provider === 'openai') return createOpenAiProvider({ apiKey: openAiApiKey, model: openAiModel || DEFAULT_OPENAI_MODEL });
  if (provider === 'gemini') return createGeminiProvider({ apiKey: geminiApiKey });
  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

async function callGemini({ apiKey, model, systemPrompt, userPrompt, media = [] }) {
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: userPrompt },
          ...media.map((item) => ({
            inline_data: { mime_type: item.mimeType, data: item.data },
          })),
        ],
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

module.exports = { createAiProvider, createGeminiProvider, createOpenAiProvider };
