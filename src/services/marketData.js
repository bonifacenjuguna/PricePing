const config = require('../config');
const binance = require('./binance');
const logger = require('../utils/logger');

// Returns Map<ourSymbol, price> for all 10 configured coins, or throws if
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

module.exports = { fetchAllPrices };
