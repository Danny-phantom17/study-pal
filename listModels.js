require('dotenv').config();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  let pageToken = '';
  let allModels = [];

  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.log('FAILED to list models:');
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    allModels = allModels.concat(data.models || []);
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  const models = allModels
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace('models/', ''));

  console.log(`Total models with generateContent support: ${models.length}`);
  models.forEach((name) => console.log(' -', name));
}

main();