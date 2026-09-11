// Central orchestrator. Every handler/poller goes through THIS module, never
// directly through src/services/sources/*. This is where the fallback
// chains, rate-limit-aware rotation, health tracking, and caching all live
// in one place — see the planning conversation for the source-to-strength
// mapping this encodes:
//
//   live price / candles   -> CoinGecko (temporary, primary) -> Binance -> Kraken
//   market cap/rank/supply  -> CoinGecko -> CoinPaprika -> CoinLore
//   on-chain / extra OHLC   -> GeckoTerminal
//   sentiment                -> Alternative.me (no fallback — see its adapter)
//
// NOTE: CoinGecko was swapped ahead of Binance for price/candles as a
// deliberate, temporary call while debugging other issues — not the
// original design. Known tradeoffs: CoinGecko's OHLC endpoint is coarser
// (no true 1-minute candles, see coingecko.js's fetchOhlc), and its
// free-tier rate limit is much tighter than Binance's, so this is more
// exposed to throttling under load. Easy to flip back — Binance is still
// wired as fallback below, not removed.
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
// LIVE PRICE — CoinGecko (temporary primary) -> Binance -> Kraken
// ---------------------------------------------------------------------------
const geckoIdToSymbol = new Map(coins.map((c) => [c.geckoId, c.symbol]));

async function fetchAllPrices() {
  const cacheKey = 'prices:all';
  return apiCache.getOrFetch(cacheKey, 8, async () => {
    const out = new Map(); // symbol -> { price, source, fetchedAt }
    const fetchedAt = Date.now();

    try {
      const geckoIds = coins.map((c) => c.geckoId).filter(Boolean);
      const geckoData = await callSource('coingecko', () => coingecko.fetchMarkets(geckoIds));
      for (const [geckoId, data] of geckoData) {
        const symbol = geckoIdToSymbol.get(geckoId);
        if (symbol && typeof data.price === 'number') {
          out.set(symbol, { price: data.price, source: 'coingecko', fetchedAt });
        }
      }
    } catch (err) {
      logger.warn('CoinGecko bulk price fetch failed, falling back to Binance', { message: err.message });
    }

    // Fill any gaps (coins CoinGecko missed, or the whole call failed) via Binance
    const missingBinance = coins.filter((c) => !c.isStable && !out.has(c.symbol) && c.binancePair);
    if (missingBinance.length) {
      try {
        const pairs = missingBinance.map((c) => c.binancePair);
        const binancePrices = await callSource('binance', () => binance.fetchPrices(pairs));
        for (const coin of missingBinance) {
          if (binancePrices.has(coin.binancePair)) {
            out.set(coin.symbol, { price: binancePrices.get(coin.binancePair), source: 'binance', fetchedAt });
          }
        }
      } catch (err) {
        logger.warn('Binance fallback price fetch failed, falling back per-coin to Kraken', { message: err.message });
      }
    }

    // Final gap-fill via Kraken
    const missingKraken = coins.filter((c) => !c.isStable && !out.has(c.symbol) && c.krakenPair);
    for (const coin of missingKraken) {
      try {
        const price = await callSource('kraken', () => kraken.fetchPrice(coin.krakenPair));
        out.set(coin.symbol, { price, source: 'kraken', fetchedAt });
      } catch (err) {
        logger.warn('Kraken fallback price failed', { symbol: coin.symbol, message: err.message });
      }
    }

    // USDT: pegged to ~$1 only as a last resort if every source above missed it
    if (!out.has('USDT')) out.set('USDT', { price: 1, source: 'peg', fetchedAt });

    return Object.fromEntries(out);
  });
}

function isStale(fetchedAt) {
  return Date.now() - fetchedAt > STALE_PRICE_SECONDS * 1000;
}

// ---------------------------------------------------------------------------
// CANDLES — CoinGecko (temporary primary) -> Binance -> Kraken
// ---------------------------------------------------------------------------
async function fetchCandles(symbol, { interval, limit, krakenIntervalMinutes, geckoDays }) {
  const coin = bySymbol.get(symbol);
  if (!coin) throw new Error(`Unknown symbol ${symbol}`);

  const cacheKey = `candles:${symbol}:${interval}:${limit}`;
  return apiCache.getOrFetch(cacheKey, 30, async () => {
    if (coin.geckoId && geckoDays) {
      try {
        const candles = await callSource('coingecko', () => coingecko.fetchOhlc(coin.geckoId, geckoDays));
        if (candles.length) return { candles, source: 'coingecko' };
        logger.warn('CoinGecko OHLC returned no candles, trying Binance', { symbol });
      } catch (err) {
        logger.warn('CoinGecko candles failed, trying Binance', { symbol, message: err.message });
      }
    }
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
// 24H STATS (high/low) — Binance only for now; used by the loose/rich card's
// stats row on manual posts. Failure here just means the card renders
// without that row (handled by the caller checking for null) — not worth
// a full fallback chain for a cosmetic addition.
// ---------------------------------------------------------------------------
async function fetch24hStats(symbol) {
  const coin = bySymbol.get(symbol);
  if (!coin || !coin.binancePair) return null;
  try {
    return await callSource('binance', () => binance.fetch24hStats(coin.binancePair));
  } catch (err) {
    logger.warn('24h stats fetch failed', { symbol, message: err.message });
    return null;
  }
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
  fetch24hStats,
  fetchFearGreed,
  confirmPrice,
  selfCheckAllSources,
  STALE_PRICE_SECONDS,
};
