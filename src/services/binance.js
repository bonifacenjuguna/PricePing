const logger = require('../utils/logger');

const BASE_URL = 'https://api.binance.com';
const REQUEST_TIMEOUT_MS = 10000;

function withTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

// Uses /api/v3/ticker/price with a batched `symbols` param — one HTTP call
// returns every pair at once. This endpoint requires no API key and has a
// long-stable response shape: [{ symbol, price }, ...]. Weight cost for a
// batched request is fixed regardless of how many symbols are included, so
// even at a 30s poll interval this stays far under Binance's public rate
// limit (1200 weight/min per IP).
//
// pairs: array of Binance symbol strings, e.g. ["BTCUSDT", "ETHUSDT"]
// returns: Map<pair, number> of pair -> last price, or throws on failure.
async function fetchPrices(pairs) {
  if (!pairs.length) return new Map();

  const symbolsParam = encodeURIComponent(JSON.stringify(pairs));
  const url = `${BASE_URL}/api/v3/ticker/price?symbols=${symbolsParam}`;
  const { signal, clear } = withTimeout();

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Binance responded ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Unexpected Binance response shape (expected array)');
    }

    const map = new Map();
    for (const entry of data) {
      if (!entry || typeof entry.symbol !== 'string' || typeof entry.price !== 'string') {
        logger.warn('Skipping malformed Binance ticker entry', entry);
        continue;
      }
      const price = Number(entry.price);
      if (!Number.isFinite(price)) {
        logger.warn('Skipping non-numeric price from Binance', entry);
        continue;
      }
      map.set(entry.symbol, price);
    }
    return map;
  } finally {
    clear();
  }
}

// Batched 24hr rolling stats — used for the manual /post card (24h high/
// low/%), the daily digest, and "big mover of the day". One call for every
// pair, same batching pattern as fetchPrices.
// returns: Map<pair, { priceChangePercent, highPrice, lowPrice }>
async function fetch24hrStats(pairs) {
  if (!pairs.length) return new Map();

  const symbolsParam = encodeURIComponent(JSON.stringify(pairs));
  const url = `${BASE_URL}/api/v3/ticker/24hr?symbols=${symbolsParam}`;
  const { signal, clear } = withTimeout();

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Binance responded ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected Binance response shape (expected array)');

    const map = new Map();
    for (const entry of data) {
      if (!entry || typeof entry.symbol !== 'string') continue;
      const priceChangePercent = Number(entry.priceChangePercent);
      const highPrice = Number(entry.highPrice);
      const lowPrice = Number(entry.lowPrice);
      const openPrice = Number(entry.openPrice);
      const quoteVolume = Number(entry.quoteVolume);
      if (![priceChangePercent, highPrice, lowPrice].every(Number.isFinite)) {
        logger.warn('Skipping malformed Binance 24hr entry', entry);
        continue;
      }
      map.set(entry.symbol, {
        priceChangePercent,
        highPrice,
        lowPrice,
        openPrice: Number.isFinite(openPrice) ? openPrice : null,
        quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : null,
      });
    }
    return map;
  } finally {
    clear();
  }
}

// Candlestick data for charts/sparklines. interval e.g. '1m','15m','1h','4h','1d'.
// returns: array of { openTime, close } ordered oldest -> newest.
async function fetchKlines(pair, interval, limit) {
  const url = `${BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(
    interval
  )}&limit=${encodeURIComponent(limit)}`;
  const { signal, clear } = withTimeout();

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Binance responded ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected Binance klines response shape (expected array)');

    return data
      .map((row) => ({
        openTime: row[0],
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
      }))
      .filter((row) => Number.isFinite(row.close) && Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low));
  } finally {
    clear();
  }
}

module.exports = { fetchPrices, fetch24hrStats, fetchKlines };
