const config = require('../config');
const logger = require('../utils/logger');
const marketData = require('./marketData');
const thresholdsDb = require('../db/thresholds');
const coinStateDb = require('../db/coinState');
const alertsLogDb = require('../db/alertsLog');
const settingsDb = require('../db/settings');
const heartbeatDb = require('../db/heartbeat');
const events = require('../db/events');
const telegramSender = require('./telegramSender');

let consecutiveFailures = 0;
let failureAlertSent = false;
let capNotifiedThisWindow = false;

function coinBySymbol(symbol) {
  return config.coins.find((c) => c.symbol === symbol);
}

function cooldownActive(lastAlertAt) {
  if (!lastAlertAt) return false;
  const elapsedMs = Date.now() - new Date(lastAlertAt).getTime();
  return elapsedMs < config.cooldownMinutes * 60 * 1000;
}

function muteActive(pausedUntil) {
  if (!pausedUntil) return false;
  return new Date(pausedUntil).getTime() > Date.now();
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

// Global pause supports an optional snooze wake-time (/pause 2h). If it's
// passed, auto-resume before doing anything else this tick.
async function resolvePauseState() {
  const pausedUntil = await settingsDb.getPausedUntil();
  if (pausedUntil && pausedUntil.getTime() <= Date.now()) {
    await settingsDb.setPaused(false);
    logger.info('Snooze expired — auto-resumed');
    return false;
  }
  return settingsDb.isPaused();
}

// Milestone check: has price crossed into a new step-multiple band since
// the last time we alerted on one? Independent of the threshold/cooldown
// system — its own natural "cooldown" is that price has to move a full
// step to re-trigger. Returns an alert object or null.
function checkMilestone(coin, price, lastMilestone) {
  if (!coin.milestoneStep || coin.isStable) return null;
  const level = Math.floor(price / coin.milestoneStep) * coin.milestoneStep;
  if (lastMilestone === null || lastMilestone === undefined) return { seedOnly: true, level };
  if (level === lastMilestone) return null;
  return { seedOnly: false, level, direction: level > lastMilestone ? 'up' : 'down' };
}

function qualifiesForThresholdAlert(price, baseline, threshold) {
  if (!threshold) return { qualifies: false };
  const changeUsd = price - baseline;
  const changePct = (changeUsd / baseline) * 100;
  const moveSize = threshold.type === 'pct' ? Math.abs(changePct) : Math.abs(changeUsd);
  return { qualifies: moveSize >= threshold.value, changeUsd, changePct };
}

async function tickInner(bot) {
  const paused = await resolvePauseState();
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

    // Milestone check runs independently of threshold/mute-for-threshold —
    // still skipped if the coin itself is muted, since a mute means "don't
    // post about this coin," full stop.
    if (!muteActive(state.pausedUntil)) {
      const milestone = checkMilestone(coin, price, state.lastMilestone);
      if (milestone) {
        await coinStateDb.setLastMilestone(coin.symbol, milestone.level);
        if (!milestone.seedOnly) {
          toSend.push({
            coin,
            price,
            changeUsd: null,
            changePct: null,
            direction: milestone.direction,
            alertType: 'milestone',
            milestoneLevel: milestone.level,
          });
        }
      }
    }

    if (state.lastAlertPrice === null || state.lastAlertPrice === undefined) {
      const seeded = await coinStateDb.seedBaselineIfMissing(coin.symbol, price);
      if (seeded) continue; // first-run baseline — no threshold alert on the very first tick
    }

    if (muteActive(state.pausedUntil)) continue;

    const threshold = thresholds[coin.symbol];
    const baseline = state.lastAlertPrice;
    if (baseline === null || baseline === undefined) continue;

    const { qualifies, changeUsd, changePct } = qualifiesForThresholdAlert(price, baseline, threshold);
    if (!qualifies) continue;
    if (cooldownActive(state.lastAlertAt)) continue;

    const direction = changeUsd >= 0 ? 'up' : 'down';
    toSend.push({ coin, price, changeUsd, changePct, direction, alertType: 'threshold' });
  }

  // Hourly send cap — a safety valve against a flash-crash spamming the
  // channel every `cooldownMinutes` for hours on end. Trims the queue for
  // THIS tick only; nothing is lost permanently, coins just wait for the
  // next tick once the rolling window has room again.
  const sentLastHour = await alertsLogDb.countLastHour();
  const room = Math.max(config.maxAlertsPerHour - sentLastHour, 0);
  let capped = toSend;
  if (toSend.length > room) {
    capped = toSend.slice(0, room);
    if (!capNotifiedThisWindow) {
      capNotifiedThisWindow = true;
      await events.record('alert_cap_hit', `${toSend.length} qualified, only ${room} sent (hourly cap ${config.maxAlertsPerHour})`);
      try {
        await bot.telegram.sendMessage(
          config.adminId,
          `Hourly alert cap (${config.maxAlertsPerHour}) reached — ${toSend.length - room} alert(s) held back this tick.`
        );
      } catch {
        /* non-fatal */
      }
    }
  } else if (room > 0) {
    capNotifiedThisWindow = false;
  }

  // Sequential, with a small delay between each — stays comfortably under
  // Telegram's per-chat rate limit even if every coin alerts in the same
  // tick, and avoids rendering more than one image in memory at a time.
  for (const alert of capped) {
    const sent = await telegramSender.sendAlert(bot.telegram, alert);
    if (sent) {
      if (alert.alertType === 'threshold') {
        await coinStateDb.recordAlert(alert.coin.symbol, alert.price);
      }
      await alertsLogDb.record(alert.coin.symbol, alert.price, alert.changeUsd || 0, alert.direction, alert.alertType);
    }
    if (capped.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, config.sendDelayMs));
    }
  }
}

// One full check cycle. Runs sequentially and to completion before the
// scheduler queues the next tick — see scheduler.js. Always touches the
// heartbeat on the way out (success, pause, or Binance failure alike) —
// heartbeatWatchdog.js only cares whether the loop itself is still alive.
async function tick(bot) {
  const startedAt = Date.now();
  try {
    await tickInner(bot);
  } finally {
    const tickMs = Date.now() - startedAt;
    try {
      await heartbeatDb.touch(tickMs);
    } catch (err) {
      logger.warn('Could not update heartbeat', { message: err.message });
    }
  }
}

module.exports = { tick, coinBySymbol, qualifiesForThresholdAlert };
