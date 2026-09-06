const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const config = require('../config');
const logger = require('../utils/logger');
const coinsDb = require('../db/coins');
const { resolveLogoSvg } = require('../utils/logoFetch');

// Same as coinRegistry.js's LOGO_SIZE reasoning — cards composite this onto
// a 3x-supersampled canvas (see cardRenderer.js SUPERSAMPLE), so the source
// needs real detail at that scale, not an upscaled low-res image.
const LOGO_SIZE = 512;

const EXCHANGE_INFO_URL = 'https://api.binance.com/api/v3/exchangeInfo';
const TICKER_24H_URL = 'https://api.binance.com/api/v3/ticker/24hr';

const KNOWN_STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'PYUSD', 'EUR', 'EURI']);

// Deterministic-but-arbitrary brand color for a coin Binance gives us no
// branding info for — hashes the symbol into a hue, fixed saturation/
// lightness so every generated color still reads well as a card background
// (contrastTextColor in colors.js handles picking readable text on top).
function colorForSymbol(symbol) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) hash = (hash * 31 + symbol.charCodeAt(i)) % 360;
  const hue = hash;
  return hslToHex(hue, 65, 50);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n) => Math.round(255 * f(n)).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

// A reasonable round-number milestone spacing derived from current price
// magnitude — e.g. ~$84,000 BTC gets a $10,000 step, ~$0.87 DOT gets a
// $0.10 step. Replaces the old hand-picked milestoneStep per coin.
function milestoneStepForPrice(price) {
  if (!Number.isFinite(price) || price <= 0) return null;
  const magnitude = 10 ** Math.floor(Math.log10(price));
  return magnitude;
}

function tierForRank(rank) {
  if (rank <= config.tierMajorRankMax) return 'major';
  if (rank <= config.tierMidRankMax) return 'mid';
  return 'micro';
}

function defaultThresholdForTier(tier) {
  if (tier === 'major') return config.tierMajorThresholdPct;
  if (tier === 'mid') return config.tierMidThresholdPct;
  return config.tierMicroThresholdPct;
}

async function fetchLogoToDisk(coin) {
  const { svgContent, source } = await resolveLogoSvg(coin);
  const pngPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  const pngBuffer = await sharp(Buffer.from(svgContent))
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  fs.writeFileSync(pngPath, pngBuffer);
  return source;
}

function removeLogoFromDisk(symbol) {
  const pngPath = path.join(config.logosDir, `${symbol.toLowerCase()}.png`);
  try {
    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
  } catch (err) {
    logger.warn(`Could not remove logo file for ${symbol}`, { message: err.message });
  }
}

// Runs the full sync: discovers currently-tradeable USDT pairs, ranks them
// by 24h quote volume for tiering, onboards new ones (with logo download),
// and removes ones no longer listed. Returns a diff summary for the
// "🔄 Force Sync Now" button and boot logs.
async function runSync() {
  const [exchangeRes, tickerRes] = await Promise.all([fetch(EXCHANGE_INFO_URL), fetch(TICKER_24H_URL)]);
  if (!exchangeRes.ok) throw new Error(`Binance exchangeInfo HTTP ${exchangeRes.status}`);
  if (!tickerRes.ok) throw new Error(`Binance ticker/24hr HTTP ${tickerRes.status}`);

  const exchangeInfo = await exchangeRes.json();
  const tickers = await tickerRes.json();
  const tickerByPair = new Map(tickers.map((t) => [t.symbol, t]));

  const quote = config.binanceQuoteAsset;
  const eligible = exchangeInfo.symbols.filter(
    (s) => s.quoteAsset === quote && s.status === 'TRADING' && tickerByPair.has(s.symbol)
  );

  // Rank by 24h quote volume, descending, to assign tiers.
  const ranked = eligible
    .map((s) => ({ pair: s.symbol, baseAsset: s.baseAsset, ticker: tickerByPair.get(s.symbol) }))
    .sort((a, b) => Number(b.ticker.quoteVolume) - Number(a.ticker.quoteVolume));

  const existing = await coinsDb.getAll();
  const existingSymbols = new Set(existing.map((c) => c.symbol));
  const liveSymbols = new Set(ranked.map((r) => r.baseAsset.toUpperCase()));

  const added = [];
  const updated = [];
  const removed = [];

  for (let i = 0; i < ranked.length; i += 1) {
    const rank = i + 1;
    const { pair, baseAsset, ticker } = ranked[i];
    const symbol = baseAsset.toUpperCase();
    const tier = tierForRank(rank);
    const isStable = KNOWN_STABLES.has(symbol);
    const price = Number(ticker.lastPrice);
    const isNew = !existingSymbols.has(symbol);

    const coin = {
      symbol,
      name: symbol, // Binance gives no display name — symbol doubles as name; owner-editable later if desired
      binancePair: pair,
      color: colorForSymbol(symbol),
      isStable,
      milestoneStep: isStable ? null : milestoneStepForPrice(price),
      tier,
      defaultThresholdValue: isStable ? 0.5 : defaultThresholdForTier(tier),
      defaultThresholdType: 'pct',
    };

    await coinsDb.upsertFromSync(coin);
    await coinsDb.setLastPrice(symbol, price);

    if (isNew) {
      added.push(symbol);
      try {
        const source = await fetchLogoToDisk(coin);
        logger.info(`Downloaded logo for new coin ${symbol} (${source})`);
      } catch (err) {
        logger.warn(`Could not download logo for new coin ${symbol}`, { message: err.message });
      }
    } else {
      const pngPath = path.join(config.logosDir, `${symbol.toLowerCase()}.png`);
      if (!fs.existsSync(pngPath)) {
        // Railway's filesystem is ephemeral — a redeploy wipes runtime-
        // written logos, so re-fetch anything missing on this pass too.
        try {
          await fetchLogoToDisk(coin);
        } catch (err) {
          logger.warn(`Could not regenerate missing logo for ${symbol}`, { message: err.message });
        }
      }
      updated.push(symbol);
    }
  }

  for (const coin of existing) {
    if (!liveSymbols.has(coin.symbol)) {
      await coinsDb.remove(coin.symbol);
      removeLogoFromDisk(coin.symbol);
      removed.push(coin.symbol);
    }
  }

  logger.info('Binance sync complete', { added: added.length, updated: updated.length, removed: removed.length });
  return { added, removed, total: ranked.length };
}

let syncTimer = null;
function startSyncSchedule() {
  runSync().catch((err) => logger.warn('Initial Binance sync failed', { message: err.message }));
  syncTimer = setInterval(() => {
    runSync().catch((err) => logger.warn('Scheduled Binance sync failed', { message: err.message }));
  }, config.binanceSyncIntervalMs);
}

function stopSyncSchedule() {
  if (syncTimer) clearInterval(syncTimer);
}

module.exports = { runSync, startSyncSchedule, stopSyncSchedule, tierForRank, defaultThresholdForTier };
