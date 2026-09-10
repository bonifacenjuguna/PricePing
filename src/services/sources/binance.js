// Primary source for live price + candlesticks. Public market-data
// endpoints need no API key/auth (see the earlier research: only account/
// trading endpoints require a key). Deepest liquidity, most accurate
// pricing for majors, generous free rate limits, real OHLCV.
const fetch = require('node-fetch');

const BASE = 'https://api.binance.com';
const TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// pairs: array of Binance symbol strings, e.g. ['BTCUSDT','ETHUSDT']
// Returns Map<pair, price>
async function fetchPrices(pairs) {
  const data = await fetchJson(`${BASE}/api/v3/ticker/price`);
  const map = new Map(data.map((d) => [d.symbol, parseFloat(d.price)]));
  const out = new Map();
  for (const p of pairs) if (map.has(p)) out.set(p, map.get(p));
  return out;
}

// 24h stats (high/low/pct change) for a single pair
async function fetch24hStats(pair) {
  const d = await fetchJson(`${BASE}/api/v3/ticker/24hr?symbol=${pair}`);
  return {
    highPrice: parseFloat(d.highPrice),
    lowPrice: parseFloat(d.lowPrice),
    priceChangePercent: parseFloat(d.priceChangePercent),
  };
}

// Candlesticks. interval: '1m'|'15m'|'2h'|'6h' etc (Binance kline intervals)
async function fetchCandles(pair, interval, limit) {
  const d = await fetchJson(`${BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
  return d.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

module.exports = { fetchPrices, fetch24hStats, fetchCandles };
