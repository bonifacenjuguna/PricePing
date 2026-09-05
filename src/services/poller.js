const config = require('../config');
const logger = require('../utils/logger');
const marketData = require('./marketData');
const thresholdsDb = require('../db/thresholds');
const coinStateDb = require('../db/coinState');
const alertsLogDb = require('../db/alertsLog');
const settingsDb = require('../db/settings');
const heartbeatDb = require('../db/heartbeat');
const channelsDb = require('../db/channels');
const milestonesDb = require('../db/milestones');
const cooldownsDb = require('../db/cooldowns');
const events = require('../db/events');
const heldBackAlertsDb = require('../db/heldBackAlerts');
const telegramSender = require('./telegramSender');
const rulesEngine = require('./rulesEngine');

let consecutiveFailures = 0;
let failureAlertSent = false;
let noDefaultChannelWarned = false;
const consecutiveMisses = new Map(); // symbol -> count of ticks with no price returned
const delistWarned = new Set(); // symbols already flagged this "episode" — resets when price returns
const DELIST_MISS_THRESHOLD = 20; // ~10 minutes at the default 30s poll interval

function coinBySymbol(symbol) {
  return config.coins.find((c) => c.symbol === symbol);
}

function cooldownActive(lastAlertAt, cooldownMinutes) {
  if (!lastAlertAt) return false;
  const elapsedMs = Date.now() - new Date(lastAlertAt).getTime();
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

function muteActive(pausedUntil) {
  if (!pausedUntil) return false;
  return new Date(pausedUntil).getTime() > Date.now();
}

// Handles overnight windows (e.g. start=22, end=7 means "quiet from 22:00
// to 07:00 UTC", wrapping past midnight) as well as same-day windows.
function isWithinQuietHours(quietHours, now = new Date()) {
  if (!quietHours) return false;
  const { startHourUtc, endHourUtc } = quietHours;
  const hour = now.getUTCHours();
  if (startHourUtc === endHourUtc) return false; // a zero-width window means "off"
  if (startHourUtc < endHourUtc) return hour >= startHourUtc && hour < endHourUtc;
  return hour >= startHourUtc || hour < endHourUtc; // wraps past midnight
}

async function handleBinanceFailure(bot, err) {
  consecutiveFailures += 1;
  logger.warn(`Binance fetch failed (${consecutiveFailures} consecutive)`, { message: err.message });

  const threshold = await settingsDb.getRuntimeLimit('binanceFailureAlertThreshold', config.binanceFailureAlertThreshold);
  if (consecutiveFailures >= threshold && !failureAlertSent) {
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
// the last time we alerted on one? step: the coin's EFFECTIVE step (a
// /setmilestone override, or the factory default from coins.js) — null
// means milestones are off for this coin. Independent of the threshold/
// cooldown system — its own natural "cooldown" is that price has to move
// a full step to re-trigger. Returns an alert object or null.
function checkMilestone(coin, price, step, lastMilestone) {
  if (!step || coin.isStable) return null;
  const level = Math.floor(price / step) * step;
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

// Bot Modes (see db/settings.js): scales the DEFAULT threshold/cooldown/cap
// up or down together. A threshold the admin explicitly set (isCustom) is
// never scaled — they already chose that exact number. A per-coin cooldown
// override works the same way (it's already only applied when no override
// exists, see below) — this function only touches the base/default case.
function effectiveThresholdValue(threshold, modeDef) {
  if (!threshold) return threshold;
  if (threshold.isCustom) return threshold;
  return { ...threshold, value: threshold.value * modeDef.thresholdMultiplier };
}

async function tickInner(bot) {
  const paused = await resolvePauseState();
  if (paused) return;

  const quietHours = await settingsDb.getQuietHours();
  const quietNow = isWithinQuietHours(quietHours);
  const compact = await settingsDb.getCompactCards();

  // Bot Mode + live runtime limits — see db/settings.js. modeDef scales the
  // seeded defaults below; a value already overridden via /limits or an
  // explicit per-coin choice is left alone (see effectiveThresholdValue and
  // the cooldown lookup further down).
  const modeKey = await settingsDb.getBotMode();
  const modeDef = settingsDb.getModeDefinition(modeKey);
  const [baseCooldownMinutes, baseMaxAlertsPerHour, sendDelayMs] = await Promise.all([
    settingsDb.getRuntimeLimit('cooldownMinutes', config.cooldownMinutes),
    settingsDb.getRuntimeLimit('maxAlertsPerHour', config.maxAlertsPerHour),
    settingsDb.getRuntimeLimit('sendDelayMs', config.sendDelayMs),
  ]);
  const effectiveMaxAlertsPerHour = Math.max(1, Math.round(baseMaxAlertsPerHour * modeDef.hourlyCapMultiplier));

  const [thresholdChannel, milestoneChannel] = await Promise.all([
    channelsDb.resolveForType('threshold'),
    channelsDb.resolveForType('milestone'),
  ]);
  if (!thresholdChannel && !milestoneChannel) {
    if (!noDefaultChannelWarned) {
      noDefaultChannelWarned = true;
      logger.error('No default channel configured — alerts have nowhere to go. Run migrations or /addchannel + /setdefaultchannel.');
    }
    return;
  }
  noDefaultChannelWarned = false;

  const [thresholds, coinStates, milestoneSteps, cooldownOverrides] = await Promise.all([
    thresholdsDb.getAll(),
    coinStateDb.getAll(),
    milestonesDb.getAll(),
    cooldownsDb.getAll(),
  ]);

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
    if (price === undefined) {
      // Tracks a coin whose price has stopped coming back from Binance —
      // e.g. delisted, pair renamed, or a typo in a runtime-added pair.
      // Distinct from a full Binance outage (handled above): this can
      // happen for just ONE coin while everything else reports fine.
      const misses = (consecutiveMisses.get(coin.symbol) || 0) + 1;
      consecutiveMisses.set(coin.symbol, misses);
      if (misses === DELIST_MISS_THRESHOLD && !delistWarned.has(coin.symbol)) {
        delistWarned.add(coin.symbol);
        events.record('symbol_no_price', `${coin.symbol} (${coin.binancePair || coin.impliedFromInverse}) has returned no price for ${misses} consecutive ticks`).catch(() => {});
        bot.telegram
          .sendMessage(
            config.adminId,
            `\u26A0\uFE0F ${coin.symbol} hasn't returned a price from Binance in a while (~${Math.round(
              (misses * config.pollIntervalMs) / 60000
            )} minutes). It may have been delisted, renamed, or there's a typo in its pair. Worth checking with /prices.`
          )
          .catch(() => {});
      }
      continue;
    }
    if (consecutiveMisses.has(coin.symbol)) {
      consecutiveMisses.delete(coin.symbol);
      delistWarned.delete(coin.symbol);
    }

    await coinStateDb.updateLastPrice(coin.symbol, price);

    const state = coinStates[coin.symbol] || {};
    const milestoneInfo = milestoneSteps.get(coin.symbol) || { step: coin.milestoneStep };

    if (!muteActive(state.pausedUntil) && milestoneChannel) {
      const milestone = checkMilestone(coin, price, milestoneInfo.step, state.lastMilestone);
      if (milestone) {
        if (milestone.seedOnly) {
          await coinStateDb.setLastMilestone(coin.symbol, milestone.level);
        } else if (!quietNow) {
          // Deliberately NOT calling coinStateDb.setLastMilestone() here —
          // that only happens after this alert actually sends (see the
          // send loop below). Recording it here, before the hourly cap is
          // even applied, meant a milestone cut by the cap could never be
          // detected again next tick (state already showed it as "done")
          // — silently and permanently lost despite the cap's own comment
          // claiming otherwise. Threshold alerts never had this bug since
          // their baseline (coinStateDb.recordAlert) was already
          // post-send-only.
          //
          // "Big" milestone = crossing a multiple of 10x the step (e.g.
          // every $5,000 for a coin with a $500 step) — gets a more
          // prominent card treatment, see cardRenderer.js.
          const isBigMilestone = milestoneInfo.step > 0 && Math.abs(milestone.level / (milestoneInfo.step * 10)) % 1 < 1e-9;
          toSend.push({
            coin,
            price,
            changeUsd: null,
            changePct: null,
            direction: milestone.direction,
            alertType: 'milestone',
            milestoneLevel: milestone.level,
            isBigMilestone,
            compact,
            channel: milestoneChannel,
          });
        }
      }
    }

    if (state.lastAlertPrice === null || state.lastAlertPrice === undefined) {
      const seeded = await coinStateDb.seedBaselineIfMissing(coin.symbol, price);
      if (seeded) continue; // first-run baseline — no threshold alert on the very first tick
    }

    if (muteActive(state.pausedUntil) || !thresholdChannel) continue;

    const threshold = effectiveThresholdValue(thresholds[coin.symbol], modeDef);
    const baseline = state.lastAlertPrice;
    if (baseline === null || baseline === undefined) continue;

    const { qualifies, changeUsd, changePct } = qualifiesForThresholdAlert(price, baseline, threshold);
    if (!qualifies || quietNow) continue;

    // A per-coin cooldown override (?? branch below) is an explicit choice,
    // same principle as isCustom on thresholds — never mode-scaled. Only
    // the shared base cooldown is.
    const cooldownMinutes = cooldownOverrides[coin.symbol] ?? baseCooldownMinutes * modeDef.cooldownMultiplier;
    if (cooldownActive(state.lastAlertAt, cooldownMinutes)) continue;

    const direction = changeUsd >= 0 ? 'up' : 'down';
    toSend.push({
      coin,
      price,
      changeUsd,
      changePct,
      direction,
      alertType: 'threshold',
      threshold,
      cooldownRemainingMs: cooldownMinutes * 60 * 1000,
      compact,
      channel: thresholdChannel,
    });
  }

  // Hourly send cap — a safety valve against a flash-crash spamming the
  // channel every `cooldownMinutes` for hours on end. Trims the queue for
  // THIS tick only. Threshold alerts naturally retry next tick (their
  // baseline only advances on actual send, see below) and milestones now
  // do too (see the fix above) — nothing here should be permanently lost
  // anymore, but every held-back alert is logged either way so there's an
  // actual visible record instead of just a warning message with nothing
  // to show for it (Safety & Admin \u2192 Held-back alerts).
  const sentLastHour = await alertsLogDb.countLastHour();
  const room = Math.max(effectiveMaxAlertsPerHour - sentLastHour, 0);
  let capped = toSend;
  if (toSend.length > room) {
    capped = toSend.slice(0, room);
    const overflow = toSend.slice(room);
    for (const alert of overflow) {
      // eslint-disable-next-line no-await-in-loop
      await heldBackAlertsDb.record(alert.coin.symbol, alert.alertType, `hourly cap (${effectiveMaxAlertsPerHour}) reached`);
    }
    // DB-backed dedup, not an in-memory flag — this bot gets redeployed
    // often (a zip upload, not a long-lived unchanged process), and an
    // in-memory flag resets on every restart, which was refiring this
    // warning mid-episode on every redeploy rather than once per hour.
    const lastNotified = await settingsDb.getLastCapNotifiedAt();
    const dueForNotify = !lastNotified || Date.now() - lastNotified.getTime() > 55 * 60 * 1000;
    if (dueForNotify) {
      await settingsDb.setLastCapNotifiedAt(new Date());
      await events.record('alert_cap_hit', `${toSend.length} qualified, only ${room} sent (hourly cap ${effectiveMaxAlertsPerHour})`);
      try {
        await bot.telegram.sendMessage(
          config.adminId,
          `Hourly alert cap (${effectiveMaxAlertsPerHour}) reached \u2014 ${toSend.length - room} alert(s) held back this tick. See Safety & Admin \u2192 Held-back alerts, or /heldback.`
        );
      } catch {
        /* non-fatal */
      }
    }
  }

  // Anti-Spam's extra restriction: a minimum gap between ANY two posts,
  // regardless of which coin — on top of (not instead of) the per-coin
  // cooldown above. Other modes don't set minGapBetweenPostsSeconds, so
  // this is a no-op for them.
  if (modeDef.minGapBetweenPostsSeconds && capped.length) {
    const lastSentRaw = await settingsDb.get('last_any_alert_sent_at');
    const lastSentAt = lastSentRaw ? new Date(lastSentRaw).getTime() : 0;
    if (Date.now() - lastSentAt < modeDef.minGapBetweenPostsSeconds * 1000) {
      for (const alert of capped) {
        // eslint-disable-next-line no-await-in-loop
        await heldBackAlertsDb.record(alert.coin.symbol, alert.alertType, `Anti-Spam mode: minimum ${modeDef.minGapBetweenPostsSeconds}s between posts`);
      }
      capped = [];
    }
  }


  // Sequential, with a small delay between each — stays comfortably under
  // Telegram's per-chat rate limit even if every coin alerts in the same
  // tick, and avoids rendering more than one image in memory at a time.
  for (const alert of capped) {
    const sent = await telegramSender.sendAlert(bot.telegram, alert, alert.channel);
    if (sent) {
      await settingsDb.set('last_any_alert_sent_at', new Date().toISOString());
      if (alert.alertType === 'threshold') {
        await coinStateDb.recordAlert(alert.coin.symbol, alert.price);
      } else if (alert.alertType === 'milestone') {
        await coinStateDb.setLastMilestone(alert.coin.symbol, alert.milestoneLevel);
      }
      await alertsLogDb.record(
        alert.coin.symbol,
        alert.price,
        alert.changeUsd || 0,
        alert.direction,
        alert.alertType,
        alert.channel.name
      );
      // Automation: any rule watching this trigger fires now, independent
      // of whether the primary send is the only thing the admin wanted.
      await rulesEngine.evaluate(bot.telegram, alert);
    }
    if (capped.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, sendDelayMs));
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

module.exports = { tick, coinBySymbol, qualifiesForThresholdAlert, checkMilestone, isWithinQuietHours, effectiveThresholdValue };
