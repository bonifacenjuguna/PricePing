const config = require('../config');
const logger = require('../utils/logger');
const marketData = require('./marketData');
const thresholdsDb = require('../db/thresholds');
const coinStateDb = require('../db/coinState');
const alertsLogDb = require('../db/alertsLog');
const settingsDb = require('../db/settings');
const events = require('../db/events');
const telegramSender = require('./telegramSender');

let consecutiveFailures = 0;
let failureAlertSent = false;

function coinBySymbol(symbol) {
  return config.coins.find((c) => c.symbol === symbol);
}

function cooldownActive(lastAlertAt) {
  if (!lastAlertAt) return false;
  const elapsedMs = Date.now() - new Date(lastAlertAt).getTime();
  return elapsedMs < config.cooldownMinutes * 60 * 1000;
}

async function handleBinanceFailure(bot, err) {
  consecutiveFailures += 1;
  logger.warn(`Binance fetch failed (${consecutiveFailures} consecutive)`, { message: err.message });

  if (consecutiveFailures >= config.binanceFailureAlertThreshold && !failureAlertSent) {
    failureAlertSent = true;
    await events.record('binance_outage', `${consecutiveFailures} consecutive failed ticks`);
    try {
      await bot.telegram.sendMessage(
        config.adminId,
        `Heads up: Binance price fetch has failed ${consecutiveFailures} times in a row. ` +
          `Price alerts are paused until it recovers.`
      );
    } catch (notifyErr) {
      logger.warn('Could not notify admin of Binance outage', { message: notifyErr.message });
    }
  }
}

// One full check cycle: fetch current prices, compare each coin against
// its threshold + cooldown, and send any alerts that qualify. Runs
// sequentially and to completion before the scheduler queues the next
// tick — see scheduler.js.
async function tick(bot) {
  const paused = await settingsDb.isPaused();
  if (paused) return;

  const [thresholds, coinStates] = await Promise.all([thresholdsDb.getAll(), coinStateDb.getAll()]);

  let prices;
  try {
    prices = await marketData.fetchAllPrices();
    if (consecutiveFailures > 0) {
      logger.info(`Binance recovered after ${consecutiveFailures} failed ticks`);
    }
    consecutiveFailures = 0;
    failureAlertSent = false;
  } catch (err) {
    await handleBinanceFailure(bot, err);
    return;
  }

  const toSend = [];

  for (const coin of config.coins) {
    const price = prices.get(coin.symbol);
    if (price === undefined) continue;

    await coinStateDb.updateLastPrice(coin.symbol, price);

    const state = coinStates[coin.symbol] || {};
    if (state.lastAlertPrice === null || state.lastAlertPrice === undefined) {
      const seeded = await coinStateDb.seedBaselineIfMissing(coin.symbol, price);
      if (seeded) continue; // first-run baseline — no alert on the very first tick
    }

    const threshold = thresholds[coin.symbol];
    if (threshold === undefined) continue;

    const baseline = state.lastAlertPrice;
    if (baseline === null || baseline === undefined) continue;

    const changeUsd = price - baseline;
    if (Math.abs(changeUsd) < threshold) continue;

    if (cooldownActive(state.lastAlertAt)) continue;

    const direction = changeUsd >= 0 ? 'up' : 'down';
    const changePct = (changeUsd / baseline) * 100;

    toSend.push({ coin, price, changeUsd, changePct, direction });
  }

  // Sequential, with a small delay between each — stays comfortably under
  // Telegram's per-chat rate limit even if every coin alerts in the same
  // tick, and avoids rendering more than one image in memory at a time.
  for (const alert of toSend) {
    const sent = await telegramSender.sendAlert(bot.telegram, alert);
    if (sent) {
      await coinStateDb.recordAlert(alert.coin.symbol, alert.price);
      await alertsLogDb.record(alert.coin.symbol, alert.price, alert.changeUsd, alert.direction);
    }
    if (toSend.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, config.sendDelayMs));
    }
  }
}

module.exports = { tick, coinBySymbol };
