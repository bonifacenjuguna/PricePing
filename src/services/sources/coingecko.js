// Primary source for live price AND aggregated market data (market cap,
// rank, supply, ATH/ATL) and coin logo images, for now — swapped ahead of
// Binance as the primary price/candle source per a deliberate, temporary
// call to de-risk while debugging other issues. Keyless public API —
// rate-limited (~10-30 calls/min) but no account/key needed. Its OHLC
// endpoint is coarser than an exchange's kline data (see fetchOhlc below)
// — that's the known tradeoff of this swap, not a bug.
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

// CoinGecko's OHLC endpoint — coarser than an exchange's kline data by
// design: granularity is auto-selected by CoinGecko based on `days`, not
// independently choosable. 1-2 days -> 30min candles, 3-30 days -> 4h
// candles, 31+ days -> 4-day candles. There's no true 1-minute resolution
// available here — that's the real tradeoff of using CoinGecko as primary
// instead of an exchange directly. Returns oldest->newest.
async function fetchOhlc(geckoId, days) {
  const url = `${BASE}/coins/${geckoId}/ohlc?vs_currency=usd&days=${days}`;
  const data = await fetchJson(url);
  return data.map((r) => ({ openTime: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }));
}

module.exports = { fetchMarkets, fetchOhlc };
