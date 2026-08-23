const config = require('../config');
const binance = require('./binance');
const logger = require('../utils/logger');

function coinBySymbol(symbol) {
  return config.coins.find((c) => c.symbol === symbol);
}

// Returns Map<ourSymbol, price> for all configured coins, or throws if
// the underlying Binance call fails (caller decides how to handle that).
async function fetchAllPrices() {
  const realPairs = config.coins.filter((c) => c.binancePair).map((c) => c.binancePair);

  const rawPrices = await binance.fetchPrices(realPairs);

  const result = new Map();

  for (const coin of config.coins) {
    if (coin.binancePair) {
      const price = rawPrices.get(coin.binancePair);
      if (price === undefined) {
        logger.warn(`No price returned for ${coin.symbol} (${coin.binancePair})`);
        continue;
      }
      result.set(coin.symbol, price);
    } else if (coin.impliedFromInverse) {
      // USDT: approximated as 1 / (USDC price in USDT), since USDC ~= $1.
      // See config.js for why this proxy exists instead of a real ticker.
      const basePrice = rawPrices.get(coin.impliedFromInverse);
      if (basePrice === undefined || basePrice === 0) {
        logger.warn(`Cannot derive ${coin.symbol} price — missing ${coin.impliedFromInverse}`);
        continue;
      }
      result.set(coin.symbol, 1 / basePrice);
    }
  }

  return result;
}

// 24hr change/high/low for one of our symbols. Handles the USDT-inverse
// case by deriving from klines rather than Binance's /ticker/24hr, which
// has no concept of our synthetic pair.
async function fetch24hrForSymbol(symbol) {
  const coin = coinBySymbol(symbol);
  if (!coin) return null;

  if (coin.binancePair) {
    const map = await binance.fetch24hrStats([coin.binancePair]);
    return map.get(coin.binancePair) || null;
  }

  if (coin.impliedFromInverse) {
    const candles = await binance.fetchKlines(coin.impliedFromInverse, '1h', 25);
    if (candles.length < 2) return null;
    const inverted = candles.map((c) => 1 / c.close);
    const first = inverted[0];
    const last = inverted[inverted.length - 1];
    const priceChangePercent = ((last - first) / first) * 100;
    return {
      priceChangePercent,
      highPrice: Math.max(...inverted),
      lowPrice: Math.min(...inverted),
      openPrice: first,
      quoteVolume: null, // not derivable from an inverted synthetic pair
    };
  }

  return null;
}

// Candle closes for one of our symbols, oldest -> newest. Used for /chart
// and the manual-post sparkline. Handles USDT-inverse the same way.
async function fetchKlinesForSymbol(symbol, interval, limit) {
  const coin = coinBySymbol(symbol);
  if (!coin) return [];

  if (coin.binancePair) {
    return binance.fetchKlines(coin.binancePair, interval, limit);
  }

  if (coin.impliedFromInverse) {
    const candles = await binance.fetchKlines(coin.impliedFromInverse, interval, limit);
    return candles.map((c) => ({ openTime: c.openTime, close: 1 / c.close }));
  }

  return [];
}

// Batched 24hr stats for every configured coin — one Binance call for all
// real pairs, plus a klines-derived value for USDT. Used by the daily
// digest and "big mover" pick so we don't fire 10 separate requests.
async function fetchAll24hrStats() {
  const realPairs = config.coins.filter((c) => c.binancePair).map((c) => c.binancePair);
  const rawStats = await binance.fetch24hrStats(realPairs);

  const result = new Map();
  for (const coin of config.coins) {
    if (coin.binancePair) {
      const stats = rawStats.get(coin.binancePair);
      if (stats) result.set(coin.symbol, stats);
    }
  }

  // USDT: derive from USDC's klines the same way fetch24hrForSymbol does,
  // but only bother if USDT is actually tracked.
  const usdt = config.coins.find((c) => c.symbol === 'USDT' && c.impliedFromInverse);
  if (usdt) {
    try {
      const stats = await fetch24hrForSymbol('USDT');
      if (stats) result.set('USDT', stats);
    } catch (err) {
      logger.warn('Could not derive USDT 24hr stats for digest', { message: err.message });
    }
  }

  return result;
}

module.exports = {
  fetchAllPrices,
  fetch24hrForSymbol,
  fetchAll24hrStats,
  fetchKlinesForSymbol,
  coinBySymbol,
};
