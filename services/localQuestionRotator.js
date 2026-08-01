const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'rotation-state.json');

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Returns the next `limit` questions for this chat+subject, cycling through
 * a shuffled version of the full pool. Once the pool is exhausted mid-batch,
 * it reshuffles and tops up the remainder so every batch is always full size.
 *
 * @param {string} chatId
 * @param {string} subject - normalized subject key, e.g. "chemistry"
 * @param {Array} allQuestions - full local question pool for that subject
 * @param {number} limit
 * @returns {Array} next batch of questions
 */
function getNextLocalBatch(chatId, subject, allQuestions, limit) {
  const state = loadState();
  const key = `${chatId}:${subject}`;
  let entry = state[key];

  // First request for this chat+subject, or the pool size changed
  // (e.g. you added/removed questions in the JSON file)
  if (!entry || entry.order.length !== allQuestions.length) {
    entry = { order: shuffle(allQuestions.map((_, i) => i)), cursor: 0 };
  }

  let batchIndexes = entry.order.slice(entry.cursor, entry.cursor + limit);
  entry.cursor += limit;

  if (batchIndexes.length < limit && allQuestions.length > 0) {
    const remainder = Math.min(limit, allQuestions.length) - batchIndexes.length;
    entry.order = shuffle(allQuestions.map((_, i) => i));
    entry.cursor = remainder;
    batchIndexes = batchIndexes.concat(entry.order.slice(0, remainder));
  }

  state[key] = entry;
  saveState(state);

  return batchIndexes.map((i) => allQuestions[i]);
}

module.exports = { getNextLocalBatch };