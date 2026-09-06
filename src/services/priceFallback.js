const config = require('../config');
const logger = require('../utils/logger');

// Only the "original 10" core majors get a fallback — CoinGecko's free
// tier can't sustain a full poll of hundreds of synced coins every 30s
// anyway, and these are the ones actually worth keeping alive through a
// Binance outage. See config.coreCoinSymbols (env-configurable).
const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  TRX: 'tron',
  DOGE: 'dogecoin',
  XAUT: 'tether-gold',
  USDC: 'usd-coin',
  USDT: 'tether',
};

const KRAKEN_PAIRS = {
  BTC: 'XBTUSD',
  ETH: 'ETHUSD',
  SOL: 'SOLUSD',
  XRP: 'XRPUSD',
  TRX: 'TRXUSD',
  DOGE: 'DOGEUSD',
  USDC: 'USDCUSD',
  USDT: 'USDTZUSD',
  // BNB and XAUT aren't listed on Kraken — CoinGecko-only for those two.
};

async function fromCoinGecko(symbols) {
  const ids = symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean);
  if (!ids.length) return {};
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const bySymbol = {};
  for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
    if (data[id] && data[id].usd !== undefined) bySymbol[symbol] = data[id].usd;
  }
  return bySymbol;
}

async function fromKraken(symbols) {
  const pairs = symbols.map((s) => KRAKEN_PAIRS[s]).filter(Boolean);
  if (!pairs.length) return {};
  const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`);
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const data = await res.json();
  if (data.error && data.error.length) throw new Error(data.error.join(', '));
  const bySymbol = {};
  for (const [symbol, pair] of Object.entries(KRAKEN_PAIRS)) {
    const entry = data.result && data.result[pair];
    if (entry && entry.c && entry.c[0]) bySymbol[symbol] = Number(entry.c[0]); // 'c' = last trade closed [price, lot volume]
  }
  return bySymbol;
}

// Returns { SYMBOL: price } for whichever core coins it managed to price —
// tries CoinGecko first, only calls Kraken for symbols CoinGecko missed
// (or if CoinGecko failed outright).
async function getCorePrices() {
  const symbols = config.coreCoinSymbols;
  let prices = {};

  try {
    prices = await fromCoinGecko(symbols);
  } catch (err) {
    logger.warn('CoinGecko fallback failed', { message: err.message });
  }

  const missing = symbols.filter((s) => prices[s] === undefined);
  if (missing.length) {
    try {
      const krakenPrices = await fromKraken(missing);
      prices = { ...prices, ...krakenPrices };
    } catch (err) {
      logger.warn('Kraken fallback failed', { message: err.message });
    }
  }

  return prices;
}

module.exports = { getCorePrices, COINGECKO_IDS, KRAKEN_PAIRS };
