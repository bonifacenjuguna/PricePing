const config = require('../config');
const logger = require('../utils/logger');
const binance = require('./binance');
const coinRegistry = require('./coinRegistry');
const customCoinsDb = require('../db/customCoins');
const settingsDb = require('../db/settings');
const autoSyncLogDb = require('../db/autoSyncLog');
const eventsDb = require('../db/events');

// Checked every 30 minutes; whether a run actually fires depends on
// intervalHours in the stored config (default daily) — same "cheap
// frequent check, config decides if it's actually due" pattern as
// automationScheduler.js.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
let intervalHandle = null;

// Binance lists leveraged/rebasing tokens (e.g. BTCUP, ETHDOWN, BTCBULL)
// as ordinary tradable USDT pairs. They're real symbols but their price
// has nothing to do with the underlying asset's actual market price —
// not "a new coin" in any sense a price-alert bot's admin would want
// auto-added. Filtered out by suffix.
const LEVERAGED_SUFFIXES = ['UP', 'DOWN', 'BULL', 'BEAR'];
function isLikelyLeveragedToken(baseAsset) {
  return LEVERAGED_SUFFIXES.some((suf) => baseAsset.length > suf.length + 1 && baseAsset.endsWith(suf));
}

// No brand-color or "is this a stablecoin" data exists in Binance's
// exchangeInfo response, so a newly auto-added coin gets a generated
// color and a best-effort stablecoin guess from a fixed ticker list —
// good enough for a first pass; the admin can still fix either by hand
// (color isn't editable today, but /removecoin + /addcoin covers it).
const KNOWN_STABLE_TICKERS = new Set(['USDT', 'USDC', 'FDUSD', 'DAI', 'TUSD', 'BUSD', 'USDP', 'USDE', 'PYUSD']);

// Deterministic hash -> hue so the same symbol always gets the same
// color across runs/restarts, instead of a random one that would shift
// every redeploy.
function colorFromSymbol(symbol) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return hslToHex(hue, 65, 50);
}
function hslToHex(h, s, l) {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Dry-run: fetches Binance's current spot catalog and diffs it against
// what's tracked now, without adding/removing anything. Used by both
// /syncnow (which then applies it) and the periodic job.
async function computeCandidates({ quoteAsset }) {
  const symbols = await binance.fetchExchangeInfo();
  const trackedPairs = new Set(config.coins.filter((c) => c.binancePair).map((c) => c.binancePair));
  const trackedSymbols = new Set(config.coins.map((c) => c.symbol));

  const livePairs = new Map(); // binancePair -> baseAsset
  for (const s of symbols) {
    if (s.quoteAsset !== quoteAsset) continue;
    if (s.status !== 'TRADING' || !s.isSpotTradingAllowed) continue;
    if (isLikelyLeveragedToken(s.baseAsset)) continue;
    livePairs.set(s.symbol, s.baseAsset);
  }

  const toAdd = [];
  for (const [pair, baseAsset] of livePairs) {
    if (trackedPairs.has(pair)) continue;
    if (trackedSymbols.has(baseAsset)) continue; // symbol collision guard
    toAdd.push({ symbol: baseAsset, binancePair: pair });
  }

  // Only ever consider removing a coin auto-sync itself added — never a
  // manually-added coin or one of the original 10 (removeCoin() already
  // refuses the latter anyway; this is the "former" half of that rule).
  const custom = await customCoinsDb.getAll();
  const toRemove = custom
    .filter((c) => c.source === 'autosync' && c.binancePair && !livePairs.has(c.binancePair))
    .map((c) => c.symbol);

  return { toAdd, toRemove, totalLive: livePairs.size };
}

// Applies a previously-computed (or freshly computed) diff, capped by
// maxNewPerRun/maxRemovePerRun. Used by both the manual /syncnow command
// and the periodic job — same code path either way, so behavior never
// diverges between "ran itself" and "admin ran it by hand".
async function applySync(candidates, { maxNewPerRun, maxRemovePerRun }) {
  const added = [];
  const removed = [];
  const failures = [];

  for (const symbol of candidates.toRemove.slice(0, maxRemovePerRun)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await coinRegistry.removeCoin(symbol);
      removed.push(symbol);
    } catch (err) {
      failures.push(`${symbol} (remove): ${err.message}`);
    }
  }

  for (const cand of candidates.toAdd.slice(0, maxNewPerRun)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await coinRegistry.addCoin({
        symbol: cand.symbol,
        name: cand.symbol,
        binancePair: cand.binancePair,
        color: colorFromSymbol(cand.symbol),
        isStable: KNOWN_STABLE_TICKERS.has(cand.symbol),
        source: 'autosync',
      });
      added.push(cand.symbol);
    } catch (err) {
      failures.push(`${cand.symbol} (add): ${err.message}`);
    }
  }

  return { added, removed, failures };
}

// Full pass: compute + apply + log + (if anything changed) DM the admin.
// Called by both /syncnow and the periodic interval below.
async function runSync(bot, { manual = false } = {}) {
  const cfg = await settingsDb.getAutoSyncConfig();

  let candidates;
  try {
    candidates = await computeCandidates({ quoteAsset: cfg.quoteAsset });
  } catch (err) {
    logger.warn('Coin sync: could not fetch Binance exchangeInfo', { message: err.message });
    await autoSyncLogDb.record({ error: err.message });
    return { ok: false, error: err.message };
  }

  const { added, removed, failures } = await applySync(candidates, cfg);

  await autoSyncLogDb.record({
    added,
    removed,
    candidatesSeen: candidates.toAdd.length + candidates.toRemove.length,
    error: failures.length ? failures.join('; ') : null,
  });
  await settingsDb.setAutoSyncConfig({ lastRunAt: new Date().toISOString() });

  const remainingAddCandidates = Math.max(0, candidates.toAdd.length - added.length);

  if (added.length || removed.length) {
    await eventsDb
      .recordAudit(`${manual ? 'manual sync' : 'auto-sync'}: +${added.length} -${removed.length}`)
      .catch(() => {});

    if (!manual && bot) {
      const lines = [];
      if (added.length) lines.push(`\u2795 Added: ${added.join(', ')}`);
      if (removed.length) lines.push(`\u2796 Removed (delisted on Binance): ${removed.join(', ')}`);
      try {
        await bot.telegram.sendMessage(config.adminId, `\uD83D\uDD04 Binance auto-sync ran:\n${lines.join('\n')}`);
      } catch (err) {
        logger.warn('Coin sync: could not DM admin with results', { message: err.message });
      }
    }
  }

  return { ok: true, added, removed, failures, remainingAddCandidates, totalLive: candidates.totalLive };
}

function init(bot) {
  intervalHandle = setInterval(() => {
    checkAndRun(bot).catch((err) => logger.error('Coin sync check failed', { message: err.message }));
  }, CHECK_INTERVAL_MS);
}

async function checkAndRun(bot) {
  const cfg = await settingsDb.getAutoSyncConfig();
  if (!cfg.enabled) return;

  const dueAt = cfg.lastRunAt
    ? new Date(cfg.lastRunAt).getTime() + cfg.intervalHours * 60 * 60 * 1000
    : 0; // never run yet -> due immediately
  if (Date.now() < dueAt) return;

  await runSync(bot, { manual: false });
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = { computeCandidates, applySync, runSync, init, stop, colorFromSymbol };
