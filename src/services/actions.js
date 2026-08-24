const config = require('../config');
const logger = require('../utils/logger');
const marketData = require('./marketData');
const chartRenderer = require('./chartRenderer');
const telegramSender = require('./telegramSender');
const channelsDb = require('../db/channels');
const coinStateDb = require('../db/coinState');
const alertsLogDb = require('../db/alertsLog');
const recentCoins = require('./recentCoins');

// Shared by commands.js (manual button/slash-command use) and
// automationScheduler.js (unattended recurring use) — one implementation,
// two callers, so a fix here fixes both. Every function returns
// { ok: boolean, message: string } — never throws, so callers (whether a
// live chat reply or a silent scheduled job) can handle failure uniformly.

async function postPriceUpdate(telegram, symbol, channelName) {
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) return { ok: false, message: `Unknown symbol: ${symbol}` };

  const channel = await channelsDb.resolve(channelName);
  if (!channel) {
    return { ok: false, message: channelName ? `Unknown channel: ${channelName}` : 'No default channel configured.' };
  }

  let price;
  let stats24h = null;
  let candles = [];
  try {
    const prices = await marketData.fetchAllPrices();
    price = prices.get(symbol);
    if (!coin.isStable) {
      [stats24h, candles] = await Promise.all([
        marketData.fetch24hrForSymbol(symbol).catch(() => null),
        marketData.fetchKlinesForSymbol(symbol, '15m', 96).catch(() => []),
      ]);
    }
  } catch (err) {
    logger.warn('Failed to fetch data for manual post', { message: err.message });
  }
  if (price === undefined) return { ok: false, message: 'Could not reach Binance right now — try again shortly.' };

  const priorStates = await coinStateDb.getAll();
  const priorState = priorStates[symbol];
  const changeSinceLastPost =
    priorState && priorState.lastAlertPrice !== null && priorState.lastAlertPrice !== undefined
      ? price - priorState.lastAlertPrice
      : null;
  const alertCountToday = await alertsLogDb.countTodayForSymbol(symbol);

  const sent = await telegramSender.sendManualPost(
    telegram,
    { coin, price, stats24h, candles, changeSinceLastPost, alertCountToday },
    channel
  );
  if (!sent) return { ok: false, message: `Could not post ${symbol} — try again shortly.` };

  // Resets the threshold baseline too, so a routine follow-up threshold
  // alert doesn't fire moments later for the same already-announced move.
  await coinStateDb.recordAlert(symbol, price);
  await alertsLogDb.record(symbol, price, 0, 'up', 'manual', channel.name);
  recentCoins.noteCoin(symbol);
  return { ok: true, message: `Posted ${symbol} to #${channel.name}.` };
}

async function postChartAction(telegram, symbol, periodKey, channelName) {
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) return { ok: false, message: `Unknown symbol: ${symbol}` };

  const preset = chartRenderer.PERIOD_PRESETS[periodKey];
  if (!preset) {
    return { ok: false, message: `Unknown period "${periodKey}". Choose one of: ${Object.keys(chartRenderer.PERIOD_PRESETS).join(', ')}` };
  }

  const channel = await channelsDb.resolve(channelName);
  if (!channel) {
    return { ok: false, message: channelName ? `Unknown channel: ${channelName}` : 'No default channel configured.' };
  }

  let candles;
  try {
    candles = await marketData.fetchKlinesForSymbol(symbol, preset.interval, preset.limit);
  } catch (err) {
    logger.warn('Failed to fetch klines for chart action', { message: err.message });
    return { ok: false, message: 'Could not reach Binance right now — try again shortly.' };
  }
  if (candles.length < 2) return { ok: false, message: `Not enough data to chart ${symbol} right now.` };

  const buffer = await chartRenderer.renderChart({ coin, candles, periodKey });
  const sent = await telegramSender.sendChart(telegram, { coin, buffer, periodLabel: preset.label }, channel);
  if (sent) recentCoins.noteCoin(symbol);
  return sent
    ? { ok: true, message: `Chart posted for ${symbol} to #${channel.name}.` }
    : { ok: false, message: `Could not post chart for ${symbol}.` };
}

async function broadcastMessage(telegram, channelName, rawMessage) {
  const channel = await channelsDb.resolve(channelName);
  if (!channel) {
    return { ok: false, message: channelName ? `Unknown channel: ${channelName}` : 'No default channel configured.' };
  }
  const sent = await telegramSender.sendBroadcast(telegram, rawMessage, channel);
  return sent ? { ok: true, message: `Broadcast sent to #${channel.name}.` } : { ok: false, message: 'Could not send broadcast.' };
}

module.exports = { postPriceUpdate, postChartAction, broadcastMessage };
