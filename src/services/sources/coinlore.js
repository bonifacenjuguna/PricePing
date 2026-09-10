// Fallback #3 / lightweight last resort. No key, generous limits. Also
// used as a cheap independent second opinion for milestone sanity-checks
// (see marketData.js confirmWithSecondSource).
const fetch = require('node-fetch');

const BASE = 'https://api.coinlore.net/api';
const TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`CoinLore HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// coinloreId: numeric ID string CoinLore assigns per coin (looked up via
// /api/tickers/ once at setup and cached in coins.js if we need it, or via
// the /coin/markets style symbol search — kept simple here as an ID lookup)
async function fetchTicker(coinloreId) {
  const d = await fetchJson(`${BASE}/ticker/?id=${coinloreId}`);
  const coin = Array.isArray(d) ? d[0] : d;
  return {
    price: parseFloat(coin.price_usd),
    marketCap: parseFloat(coin.market_cap_usd),
    change24hPct: parseFloat(coin.percent_change_24h),
  };
}

module.exports = { fetchTicker };
