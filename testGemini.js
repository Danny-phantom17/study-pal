require('dotenv').config();
const { createGeminiProvider } = require('./services/ai/aiProvider');

async function main() {
  console.log('Using key starting with:', (process.env.GEMINI_API_KEY || '').slice(0, 8));

  const provider = createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY });

  try {
    const result = await provider.generateCompletion({
      systemPrompt: 'Respond with valid JSON only, nothing else: {"ok": true}',
      userPrompt: 'Say hello.',
    });
    console.log('SUCCESS — Gemini responded:');
    console.log(result);
  } catch (error) {
    console.log('FAILED — this is the real error:');
    console.log(error.message);
  }
}

main();