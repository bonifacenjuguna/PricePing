// Fallback #2 for aggregated market data. Backs up CoinGecko with a
// different rate-limit bucket, so a CoinGecko throttle doesn't stall us.
const fetch = require('node-fetch');

const BASE = 'https://api.coinpaprika.com/v1';
const TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`CoinPaprika HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// paprikaId, e.g. 'btc-bitcoin'
async function fetchTicker(paprikaId) {
  const d = await fetchJson(`${BASE}/tickers/${paprikaId}`);
  return {
    price: d.quotes.USD.price,
    marketCap: d.quotes.USD.market_cap,
    change24hPct: d.quotes.USD.percent_change_24h,
  };
}

module.exports = { fetchTicker };
