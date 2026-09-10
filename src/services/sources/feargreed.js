// Fear & Greed Index. Free, no key, single GET. The de facto industry
// standard source (CoinMarketCap and most dashboards pull from here too).
// No fallback source configured deliberately — no real competitor at this
// reliability/simplicity level; if it's down we just omit the field for
// that post rather than chase a shakier alternative.
const fetch = require('node-fetch');

const BASE = 'https://api.alternative.me/fng';
const TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Alternative.me HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Returns { value: 0-100, classification: 'Extreme Fear'|...|'Extreme Greed', timestamp }
async function fetchLatest() {
  const d = await fetchJson(`${BASE}/?limit=1`);
  const entry = d.data[0];
  return {
    value: parseInt(entry.value, 10),
    classification: entry.value_classification,
    timestamp: parseInt(entry.timestamp, 10) * 1000,
  };
}

// days: how many past days of history (for a sentiment trend chart)
async function fetchHistory(days = 30) {
  const d = await fetchJson(`${BASE}/?limit=${days}`);
  return d.data
    .map((e) => ({ value: parseInt(e.value, 10), classification: e.value_classification, timestamp: parseInt(e.timestamp, 10) * 1000 }))
    .reverse(); // oldest -> newest
}

module.exports = { fetchLatest, fetchHistory };
