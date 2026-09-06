const config = require('../config');
const logger = require('../utils/logger');
const settingsDb = require('../db/settings');
const coinsDb = require('../db/coins');
const channelsDb = require('../db/channels');
const modes = require('./modes');
const timezoneService = require('./timezoneService');
const cardRenderer = require('./cardRenderer');
const chartRenderer = require('./chartRenderer');
const telegramSender = require('./telegramSender');

const TICK_MS = 60 * 1000; // check every minute; actual cadence per post type is mode-scaled and tracked via last-run timestamps
const TICKER_24H_URL = 'https://api.binance.com/api/v3/ticker/24hr';
const KLINES_URL = 'https://api.binance.com/api/v3/klines';

async function getLastRun(key) {
  const val = await settingsDb.get(`last_run_${key}`);
  return val ? Number(val) : 0;
}
async function setLastRun(key) {
  await settingsDb.set(`last_run_${key}`, Date.now());
}

async function scaledInterval(baseMs) {
  const mode = await modes.getCurrentMode();
  return baseMs * mode.multiplier;
}

// Anti-Spam's hard daily cap — tracked per calendar day (owner's timezone)
// as a simple counter in settings, reset whenever the stored day rolls over.
async function underDailyCap() {
  const modeKey = await modes.getCurrentModeKey();
  if (!modes.isAntiSpam(modeKey)) return true;

  const tz = await timezoneService.getTimezone();
  const { weekday } = timezoneService.getPartsInTz(new Date(), tz);
  const dayKey = `${new Date().toISOString().slice(0, 10)}`; // good enough as a day boundary marker
  const storedDay = await settingsDb.get('anti_spam_day');
  let count = Number((await settingsDb.get('anti_spam_count')) || 0);
  if (storedDay !== dayKey) {
    count = 0;
    await settingsDb.set('anti_spam_day', dayKey);
    await settingsDb.set('anti_spam_count', 0);
  }
  return count < config.antiSpamMaxPostsPerDay;
}
async function recordAntiSpamPost() {
  const count = Number((await settingsDb.get('anti_spam_count')) || 0);
  await settingsDb.set('anti_spam_count', count + 1);
}

async function runChartAutomation() {
  const interval = await scaledInterval(config.chartBaseIntervalMs);
  if (Date.now() - (await getLastRun('chart')) < interval) return;
  if (!(await underDailyCap())) return;

  const coins = await coinsDb.getAll();
  const majors = coins.filter((c) => c.tier === 'major' && !c.is_stable);
  if (!majors.length) return;

  const idx = Number((await settingsDb.get('chart_rotation_idx')) || 0) % majors.length;
  const coin = majors[idx];
  await settingsDb.set('chart_rotation_idx', (idx + 1) % majors.length);

  try {
    const res = await fetch(`${KLINES_URL}?symbol=${coin.binance_pair}&interval=15m&limit=96`);
    if (!res.ok) throw new Error(`Binance klines HTTP ${res.status}`);
    const raw = await res.json();
    const candles = raw.map((k) => ({ openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) }));

    const photo = await chartRenderer.renderChart({
      coin: { symbol: coin.symbol, name: coin.name, color: coin.color },
      candles,
      periodKey: '24h',
      style: 'line',
    });

    await telegramSender.broadcast(
      'chart',
      { coin: { symbol: coin.symbol, name: coin.name }, price: candles[candles.length - 1].close, periodLabel: 'Last 24 hours' },
      photo
    );
    await recordAntiSpamPost();
  } catch (err) {
    logger.warn(`Chart automation failed for ${coin.symbol}`, { message: err.message });
  }

  await setLastRun('chart');
}

async function runMoversAutomation() {
  const modeKey = await modes.getCurrentModeKey();
  if (modes.isAntiSpam(modeKey)) return; // Anti-Spam skips Movers entirely, per design

  const interval = await scaledInterval(config.moversBaseIntervalMs);
  if (Date.now() - (await getLastRun('movers')) < interval) return;

  try {
    const coins = await coinsDb.getAll();
    const tracked = new Set(coins.filter((c) => !c.is_stable).map((c) => c.binance_pair));
    const res = await fetch(TICKER_24H_URL);
    if (!res.ok) throw new Error(`Binance ticker/24hr HTTP ${res.status}`);
    const tickers = (await res.json()).filter((t) => tracked.has(t.symbol));

    const sorted = tickers.slice().sort((a, b) => Number(b.priceChangePercent) - Number(a.priceChangePercent));
    const gainers = sorted.slice(0, 3);
    const losers = sorted.slice(-3).reverse();

    const symbolFor = (pair) => coins.find((c) => c.binance_pair === pair)?.symbol || pair;
    const lines = ['<b>📊 Top Movers (24h)</b>', '', '🟢 <b>Gainers</b>'];
    for (const t of gainers) lines.push(`${symbolFor(t.symbol)}: +${Number(t.priceChangePercent).toFixed(2)}%`);
    lines.push('', '🔴 <b>Losers</b>');
    for (const t of losers) lines.push(`${symbolFor(t.symbol)}: ${Number(t.priceChangePercent).toFixed(2)}%`);

    await telegramSender.broadcastText('movers', lines.join('\n'));
  } catch (err) {
    logger.warn('Movers automation failed', { message: err.message });
  }

  await setLastRun('movers');
}

async function runFearGreedAutomation() {
  const interval = await scaledInterval(config.feargreedBaseIntervalMs);
  if (Date.now() - (await getLastRun('feargreed')) < interval) return;
  if (!(await underDailyCap())) return;

  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    if (!res.ok) throw new Error(`alternative.me HTTP ${res.status}`);
    const data = await res.json();
    const entry = data.data && data.data[0];
    if (!entry) return;

    const emoji = Number(entry.value) >= 55 ? '🟢' : Number(entry.value) <= 45 ? '🔴' : '🟡';
    const text =
      `${emoji} <b>Fear &amp; Greed Index</b>\n\n` +
      `<b>${entry.value}</b> / 100 — ${entry.value_classification}`;

    await telegramSender.broadcastText('feargreed', text);
    await recordAntiSpamPost();
  } catch (err) {
    logger.warn('Fear & Greed automation failed', { message: err.message });
  }

  await setLastRun('feargreed');
}

async function runDigestCheck() {
  if (!config.digestEnabled) return;
  const tz = await timezoneService.getTimezone();
  const { hour, minute, weekday } = timezoneService.getPartsInTz(new Date(), tz);
  const targetHour = Number((await settingsDb.get('digest_hour')) ?? config.digestHourUtc);

  if (hour === targetHour && minute < 5) {
    const today = new Date().toISOString().slice(0, 10);
    if ((await settingsDb.get('digest_daily_last')) !== today) {
      await settingsDb.set('digest_daily_last', today);
      await sendDigest('daily');
    }
    // Weekly digest fires on the same daily slot, once per week (Monday, weekday === 1).
    if (weekday === 1) {
      const weekKey = `${today.slice(0, 4)}-W${Math.ceil(new Date().getDate() / 7)}`;
      if ((await settingsDb.get('digest_weekly_last')) !== weekKey) {
        await settingsDb.set('digest_weekly_last', weekKey);
        await sendDigest('weekly');
      }
    }
  }
}

async function sendDigest(kind) {
  try {
    const coins = await coinsDb.getAll();
    const tracked = coins.filter((c) => !c.is_stable && c.last_price);
    const res = await fetch(TICKER_24H_URL);
    const tickers = res.ok ? await res.json() : [];
    const tickerByPair = new Map(tickers.map((t) => [t.symbol, t]));

    let biggestMover = null;
    for (const coin of tracked) {
      const t = tickerByPair.get(coin.binance_pair);
      if (!t) continue; // eslint-disable-line no-continue
      const pct = Number(t.priceChangePercent);
      if (!biggestMover || Math.abs(pct) > Math.abs(biggestMover.pct)) biggestMover = { symbol: coin.symbol, pct };
    }

    const label = kind === 'daily' ? 'Daily Digest' : 'Weekly Digest';
    const lines = [`<b>📅 ${label}</b>`, ''];
    if (biggestMover) {
      lines.push(`Biggest mover: <b>${biggestMover.symbol}</b> ${biggestMover.pct > 0 ? '+' : ''}${biggestMover.pct.toFixed(2)}%`);
    }
    lines.push(`Tracked coins: ${coins.length}`);

    await telegramSender.broadcastText('digest', lines.join('\n'));
  } catch (err) {
    logger.warn(`${kind} digest failed`, { message: err.message });
  }
}

let tickTimer = null;
function startAutomation() {
  tickTimer = setInterval(() => {
    runChartAutomation().catch((err) => logger.warn('Chart automation tick failed', { message: err.message }));
    runMoversAutomation().catch((err) => logger.warn('Movers automation tick failed', { message: err.message }));
    runFearGreedAutomation().catch((err) => logger.warn('Fear & Greed automation tick failed', { message: err.message }));
    runDigestCheck().catch((err) => logger.warn('Digest check failed', { message: err.message }));
  }, TICK_MS);
}
function stopAutomation() {
  if (tickTimer) clearInterval(tickTimer);
}

module.exports = { startAutomation, stopAutomation, sendDigest, runChartAutomation, runMoversAutomation, runFearGreedAutomation };
