// Primary source for aggregated market data (market cap, rank, supply,
// ATH/ATL) and coin logo images. Keyless public API — rate-limited (~10-30
// calls/min) but no account/key needed. Not used for candlesticks (its OHLC
// endpoint is too coarse) — that's Binance/Kraken's job.
const fetch = require('node-fetch');

const BASE = 'https://api.coingecko.com/api/v3';
const TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// geckoIds: array of CoinGecko coin IDs, e.g. ['bitcoin','ethereum']
async function fetchMarkets(geckoIds) {
  const ids = geckoIds.join(',');
  const url = `${BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=false`;
  const data = await fetchJson(url);
  return new Map(data.map((d) => [d.id, {
    price: d.current_price,
    marketCap: d.market_cap,
    marketCapRank: d.market_cap_rank,
    circulatingSupply: d.circulating_supply,
    ath: d.ath,
    athDate: d.ath_date,
    atl: d.atl,
    atlDate: d.atl_date,
    change24hPct: d.price_change_percentage_24h,
    logoUrl: d.image,
  }]));
}

module.exports = { fetchMarkets };
