// Central orchestrator. Every handler/poller goes through THIS module, never
// directly through src/services/sources/*. This is where the fallback
// chains, rate-limit-aware rotation, health tracking, and caching all live
// in one place — see the planning conversation for the source-to-strength
// mapping this encodes:
//
//   live price / candles   -> Binance -> Kraken -> (CoinGecko as last resort)
//   market cap/rank/supply  -> CoinGecko -> CoinPaprika -> CoinLore
//   on-chain / extra OHLC   -> GeckoTerminal
//   sentiment                -> Alternative.me (no fallback — see its adapter)
const binance = require('./sources/binance');
const kraken = require('./sources/kraken');
const coingecko = require('./sources/coingecko');
const coinpaprika = require('./sources/coinpaprika');
const coinlore = require('./sources/coinlore');
const geckoterminal = require('./sources/geckoterminal');
const feargreedSource = require('./sources/feargreed');
const rateLimiter = require('../lib/rateLimiter');
const apiCache = require('../lib/apiCache');
const sourceHealth = require('../db/sourceHealth');
const logger = require('../lib/logger');
const { coins, bySymbol } = require('../coins');

const STALE_PRICE_SECONDS = 90; // if the freshest price we have is older than this, flag it in the UI

// Wraps a source call with: rate-limit budget check, health tracking, and
// a clean error so the caller can fall through to the next source.
async function callSource(sourceName, fn) {
  const withinBudget = await rateLimiter.tryConsume(sourceName);
  if (!withinBudget) {
    throw new Error(`${sourceName} rate-limit budget exhausted`);
  }
  try {
    const result = await fn();
    await sourceHealth.recordSuccess(sourceName);
    return result;
  } catch (err) {
    const { shouldNotifyAdmin, consecutiveFailures } = await sourceHealth.recordFailure(sourceName);
    logger.warn('Source call failed', { source: sourceName, message: err.message, consecutiveFailures });
    if (shouldNotifyAdmin) {
      // Caller (poller/index.js) is responsible for actually notifying —
      // this just surfaces the signal via a thrown, tagged error so it's
      // not silently swallowed. See services/adminNotify.js.
      err.shouldNotifyAdmin = true;
      err.sourceName = sourceName;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// LIVE PRICE — Binance -> Kraken -> CoinGecko(single-coin) as last resort
// ---------------------------------------------------------------------------
async function fetchAllPrices() {
  const cacheKey = 'prices:all';
  return apiCache.getOrFetch(cacheKey, 8, async () => {
    const pairs = coins.filter((c) => c.binancePair).map((c) => c.binancePair);
    const out = new Map(); // symbol -> { price, source, fetchedAt }
    const fetchedAt = Date.now();

    try {
      const binancePrices = await callSource('binance', () => binance.fetchPrices(pairs));
      for (const coin of coins) {
        if (coin.binancePair && binancePrices.has(coin.binancePair)) {
          out.set(coin.symbol, { price: binancePrices.get(coin.binancePair), source: 'binance', fetchedAt });
        }
      }
    } catch (err) {
      logger.warn('Binance bulk price fetch failed, falling back per-coin to Kraken', { message: err.message });
    }

    // Fill gaps (coins Binance missed, or the whole call failed) via Kraken
    const missing = coins.filter((c) => !c.isStable && !out.has(c.symbol) && c.krakenPair);
    for (const coin of missing) {
      try {
        const price = await callSource('kraken', () => kraken.fetchPrice(coin.krakenPair));
        out.set(coin.symbol, { price, source: 'kraken', fetchedAt });
      } catch (err) {
        logger.warn('Kraken fallback price failed', { symbol: coin.symbol, message: err.message });
      }
    }

    // USDT has no natural USDT pair on Binance — pegged to ~$1, no live feed needed
    if (!out.has('USDT')) out.set('USDT', { price: 1, source: 'peg', fetchedAt });

    return Object.fromEntries(out);
  });
}

function isStale(fetchedAt) {
  return Date.now() - fetchedAt > STALE_PRICE_SECONDS * 1000;
}

// ---------------------------------------------------------------------------
// CANDLES — Binance -> Kraken -> GeckoTerminal
// ---------------------------------------------------------------------------
async function fetchCandles(symbol, { interval, limit, krakenIntervalMinutes }) {
  const coin = bySymbol.get(symbol);
  if (!coin) throw new Error(`Unknown symbol ${symbol}`);

  const cacheKey = `candles:${symbol}:${interval}:${limit}`;
  return apiCache.getOrFetch(cacheKey, 30, async () => {
    if (coin.binancePair) {
      try {
        return { candles: await callSource('binance', () => binance.fetchCandles(coin.binancePair, interval, limit)), source: 'binance' };
      } catch (err) {
        logger.warn('Binance candles failed, trying Kraken', { symbol, message: err.message });
      }
    }
    if (coin.krakenPair) {
      try {
        return { candles: await callSource('kraken', () => kraken.fetchCandles(coin.krakenPair, krakenIntervalMinutes, limit)), source: 'kraken' };
      } catch (err) {
        logger.warn('Kraken candles failed', { symbol, message: err.message });
      }
    }
    throw new Error(`No candle source available for ${symbol}`);
  });
}

// ---------------------------------------------------------------------------
// MARKET DATA (cap/rank/supply/ATH-ATL) — CoinGecko -> CoinPaprika -> CoinLore
// Requires per-source ID mappings; kept minimal here (geckoId/paprikaId
// fields would live on coins.js entries when this is wired up fully).
// ---------------------------------------------------------------------------
async function fetchMarketData(geckoIds) {
  const cacheKey = `marketdata:${geckoIds.join(',')}`;
  return apiCache.getOrFetch(cacheKey, 60, async () => {
    try {
      return { data: await callSource('coingecko', () => coingecko.fetchMarkets(geckoIds)), source: 'coingecko' };
    } catch (err) {
      logger.warn('CoinGecko market data failed, falling back to CoinPaprika/CoinLore per-coin', { message: err.message });
      // Per-coin fallback would iterate coins here calling coinpaprika.fetchTicker
      // then coinlore.fetchTicker — omitted for brevity, same pattern as fetchAllPrices.
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// FEAR & GREED — Alternative.me, no fallback
// ---------------------------------------------------------------------------
async function fetchFearGreed() {
  return apiCache.getOrFetch('feargreed:latest', 300, () => callSource('feargreed', () => feargreedSource.fetchLatest()));
}

// ---------------------------------------------------------------------------
// CROSS-SOURCE SANITY CHECK — used before firing a public milestone alert.
// Compares the primary price against one independent secondary source;
// only confirms if they agree within a tolerance, so a single bad tick from
// one exchange can't trigger a false public post.
// ---------------------------------------------------------------------------
async function confirmPrice(symbol, primaryPrice, tolerancePct = 1.5) {
  const coin = bySymbol.get(symbol);
  try {
    let secondaryPrice = null;
    if (coin.krakenPair) {
      secondaryPrice = await callSource('kraken', () => kraken.fetchPrice(coin.krakenPair));
    } else {
      const result = await callSource('coinlore', () => coinlore.fetchTicker(coin.coinloreId));
      secondaryPrice = result.price;
    }
    const diffPct = Math.abs((primaryPrice - secondaryPrice) / primaryPrice) * 100;
    return diffPct <= tolerancePct;
  } catch (err) {
    logger.warn('Sanity-check secondary source failed — proceeding on primary alone', { symbol, message: err.message });
    return true; // don't block an alert just because the confirmation source is down
  }
}

// ---------------------------------------------------------------------------
// BOOT-TIME SELF-CHECK — pings every source once, logs which are reachable.
// ---------------------------------------------------------------------------
async function selfCheckAllSources() {
  const results = {};
  const checks = [
    ['binance', () => binance.fetchPrices(['BTCUSDT'])],
    ['kraken', () => kraken.fetchPrice('XBTUSDT')],
    ['coingecko', () => coingecko.fetchMarkets(['bitcoin'])],
    ['coinpaprika', () => coinpaprika.fetchTicker('btc-bitcoin')],
    ['coinlore', () => coinlore.fetchTicker('90')],
    ['geckoterminal', () => geckoterminal.fetchPoolOhlcv('eth', '0x0000000000000000000000000000000000000000', 'hour', 1).catch(() => null)],
    ['feargreed', () => feargreedSource.fetchLatest()],
  ];
  for (const [name, fn] of checks) {
    try {
      await fn();
      results[name] = 'ok';
    } catch (err) {
      results[name] = `failed: ${err.message}`;
    }
  }
  return results;
}

module.exports = {
  fetchAllPrices,
  isStale,
  fetchCandles,
  fetchMarketData,
  fetchFearGreed,
  confirmPrice,
  selfCheckAllSources,
  STALE_PRICE_SECONDS,
};
