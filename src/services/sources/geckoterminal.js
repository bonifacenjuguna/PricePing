// On-chain/DEX data. Keyless, same family as CoinGecko. Used as a
// secondary OHLC fallback when both Binance and Kraken miss a pair (e.g.
// GRAM/HYPE not fully covered on either exchange for some intervals), and
// reserved for future on-chain features.
const fetch = require('node-fetch');

const BASE = 'https://api.geckoterminal.com/api/v2';
const TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json;version=20230302' } });
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// network e.g. 'eth', poolAddress: on-chain pool contract address
async function fetchPoolOhlcv(network, poolAddress, timeframe = 'hour', limit = 100) {
  const d = await fetchJson(`${BASE}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`);
  const list = d.data.attributes.ohlcv_list; // [timestamp, open, high, low, close, volume]
  return list.map((r) => ({ openTime: r[0] * 1000, open: r[1], high: r[2], low: r[3], close: r[4] })).reverse();
}

module.exports = { fetchPoolOhlcv };
