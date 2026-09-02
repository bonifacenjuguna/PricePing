const logger = require('../utils/logger');

// alternative.me's Crypto Fear & Greed Index — free, no API key, but their
// terms require attribution "right next to the display of the data" (see
// https://alternative.me/crypto/fear-and-greed-index/#api) — the caption
// built in commands.js always credits them, don't drop that if this is
// ever reused elsewhere.
const URL = 'https://api.alternative.me/fng/?limit=1&format=json';
const CACHE_MS = 5 * 60 * 1000; // the index only updates once a day anyway — this just avoids hammering it on every tap

let cache = null; // { value, classification, timestamp, fetchedAt }

async function fetchFearGreed() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`alternative.me responded ${res.status}`);
    const body = await res.json();
    const entry = body && Array.isArray(body.data) && body.data[0];
    if (!entry) throw new Error('Unexpected response shape from alternative.me');

    cache = {
      value: Number(entry.value),
      classification: entry.value_classification,
      timestamp: Number(entry.timestamp) * 1000,
      fetchedAt: Date.now(),
    };
    return cache;
  } catch (err) {
    logger.warn('Fear & Greed fetch failed', { message: err.message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchFearGreed };
