const logger = require('../utils/logger');

const BASE_URL = 'https://api.binance.com';
const REQUEST_TIMEOUT_MS = 10000;

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
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
    clearTimeout(timeout);
  }
}

module.exports = { fetchPrices };
