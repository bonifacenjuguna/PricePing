// Fallback #1 for price + candlesticks. Public endpoints, no key. Smaller
// pair coverage than Binance but same category (real exchange trade data).
const fetch = require('node-fetch');

const BASE = 'https://api.kraken.com/0/public';
const TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
    const json = await res.json();
    if (json.error && json.error.length) throw new Error(`Kraken API error: ${json.error.join(', ')}`);
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

async function fetchPrice(krakenPair) {
  const result = await fetchJson(`${BASE}/Ticker?pair=${krakenPair}`);
  const key = Object.keys(result)[0];
  return parseFloat(result[key].c[0]); // c[0] = last trade closed price
}

// interval in minutes (1, 15, 120, 360...)
async function fetchCandles(krakenPair, intervalMinutes, limit) {
  const result = await fetchJson(`${BASE}/OHLC?pair=${krakenPair}&interval=${intervalMinutes}`);
  const key = Object.keys(result).find((k) => k !== 'last');
  const rows = result[key].slice(-limit);
  return rows.map((r) => ({
    openTime: r[0] * 1000,
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
  }));
}

module.exports = { fetchPrice, fetchCandles };
