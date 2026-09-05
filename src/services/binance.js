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

// Single-symbol price fetch — used by marketData.fetchAllPrices() as a
// fallback when the batched call above fails outright (a bad/delisted
// symbol poisons the whole batched request), so one broken pair degrades
// to "that one coin has no price" instead of "no coin has a price".
async function fetchSinglePrice(pair) {
  const { signal, clear } = withTimeout();
  try {
    const res = await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const price = Number(data && data.price);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  } finally {
    clear();
  }
}

// Checks one symbol against Binance directly — used by /addcoin before
// confirming, so a bad/typo'd pair is caught right there instead of later
// breaking the batched fetchPrices() call for every tracked coin at once
// (Binance's batched ticker endpoint rejects the whole request if even one
// symbol in it is invalid — see fetchPrices above).
async function pairExists(pair) {
  const { signal, clear } = withTimeout();
  try {
    const res = await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(pair)}`, { signal });
    return res.ok;
  } catch (err) {
    logger.warn(`Could not check Binance pair ${pair}`, { message: err.message });
    return null; // network/timeout — "couldn't check", not "invalid"
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

// Full spot symbol catalog — used by services/coinSync.js to detect
// newly-listed and delisted pairs. Deliberately called with no `symbols`
// filter param (there's no way to ask "just USDT pairs" server-side), so
// this returns Binance's entire spot catalog (2000+ entries) in one
// request; weight cost (20) is fixed regardless, and auto-sync only ever
// calls this on its own slow interval (default daily), never per-tick.
// returns: array of { symbol, baseAsset, quoteAsset, status, isSpotTradingAllowed }
async function fetchExchangeInfo() {
  const url = `${BASE_URL}/api/v3/exchangeInfo`;
  const { signal, clear } = withTimeout();

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Binance responded ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.symbols)) {
      throw new Error('Unexpected Binance exchangeInfo response shape (expected { symbols: [...] })');
    }
    return data.symbols
      .filter((s) => s && typeof s.symbol === 'string' && typeof s.baseAsset === 'string' && typeof s.quoteAsset === 'string')
      .map((s) => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        status: s.status,
        isSpotTradingAllowed: s.isSpotTradingAllowed !== false,
      }));
  } finally {
    clear();
  }
}

module.exports = { fetchPrices, fetch24hrStats, fetchKlines, pairExists, fetchSinglePrice, fetchExchangeInfo };
