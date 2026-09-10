// Runs on a timer (see index.js). For every active channel, checks every
// coin's current price against that channel's milestone step and threshold
// config, and sends alert cards for anything that qualifies. Two
// independent trigger systems sharing one card renderer, same architecture
// reviewed from PricePing:
//   milestone: price crosses into a new step-multiple band since the last
//     alerted band. Own natural cooldown (price must move a full step).
//   threshold: price has moved >= X% or $Y since the last alert, AND the
//     per-coin cooldown has elapsed.
const config = require('../config');
const { coins, bySymbol } = require('../coins');
const channelsDb = require('../db/channels');
const coinSettingsDb = require('../db/coinSettings');
const coinStateDb = require('../db/coinState');
const marketData = require('./marketData');
const cardRenderer = require('./cardRenderer');
const digestQueue = require('./digestQueue');
const adminNotify = require('./adminNotify');
const tz = require('../lib/timezone');
const logger = require('../lib/logger');

function isWithinQuietHours(hour, start, end) {
  if (start === null || start === undefined || end === null || end === undefined) return false;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // wraps past midnight
}

function checkMilestone(price, step, lastMilestone) {
  if (!step) return null;
  const level = Math.floor(price / step) * step;
  if (lastMilestone === null || lastMilestone === undefined) return { seedOnly: true, level };
  if (level === lastMilestone) return null;
  return { seedOnly: false, level, direction: level > lastMilestone ? 'up' : 'down' };
}

function qualifiesForThreshold(price, baseline, thresholdType, thresholdValue) {
  if (!thresholdValue) return { qualifies: false };
  const changeUsd = price - baseline;
  const changePct = (changeUsd / baseline) * 100;
  const moveSize = thresholdType === 'pct' ? Math.abs(changePct) : Math.abs(changeUsd);
  return { qualifies: moveSize >= thresholdValue, changeUsd, changePct };
}

function cooldownActive(lastAlertAt, cooldownMinutes) {
  if (!lastAlertAt) return false;
  return Date.now() - new Date(lastAlertAt).getTime() < cooldownMinutes * 60 * 1000;
}

// Delivery: digest-mode channels queue the alert for the digest scheduler
// to batch and flush later (see digestScheduler.js); regular channels get
// an immediate rendered card. Both paths funnel through here so the
// trigger-detection logic above doesn't need to know or care which mode
// the channel is in.
async function deliverAlert(bot, channel, alertType, entry) {
  if (channel.digest_mode) {
    await digestQueue.enqueue(channel.id, { alertType, ...entry });
    return;
  }
  const { coin, price, direction, changePct, milestoneLevel, isBigMilestone } = entry;
  try {
    const buffer = await cardRenderer.renderCard({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone, mode: channel.card_style || 'compact' });
    const caption = alertType === 'milestone'
      ? `${isBigMilestone ? '🎉 ' : ''}${coin.name} just crossed $${milestoneLevel.toLocaleString()}`
      : `${coin.name} ${direction === 'up' ? '📈' : '📉'} ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
    await bot.telegram.sendPhoto(channel.chat_id, { source: buffer }, { caption });
  } catch (err) {
    logger.error('Failed to send alert card', { channelId: channel.id, symbol: coin.symbol, message: err.message });
  }
}

async function tickChannel(bot, channel) {
  const now = new Date();
  const hourLocal = tz.getHourInZone(now, channel.timezone || 'UTC');
  // Quiet hours suppress immediate sends entirely for normal channels. For
  // digest channels, quiet hours are enforced at FLUSH time instead (see
  // digestScheduler.js) — detection here still queues normally so nothing
  // that happened during quiet hours is lost, just held until it's over.
  const quietNow = !channel.digest_mode && isWithinQuietHours(hourLocal, channel.quiet_hours_start, channel.quiet_hours_end);

  const [coinSettings, coinStates, prices] = await Promise.all([
    coinSettingsDb.getAllForChannel(channel.id),
    coinStateDb.getAllForChannel(channel.id),
    marketData.fetchAllPrices(),
  ]);

  for (const coin of coins) {
    const priceInfo = prices[coin.symbol];
    if (!priceInfo) continue; // eslint-disable-line no-continue
    const { price, fetchedAt } = priceInfo;
    if (marketData.isStale(fetchedAt)) continue; // eslint-disable-line no-continue

    const settings = coinSettings.get(coin.symbol);
    const state = coinStates.get(coin.symbol) || {};

    await coinStateDb.updateLastPrice(channel.id, coin.symbol, price);
    if (settings.muted || coin.isStable) continue; // eslint-disable-line no-continue

    // ---- Milestone check ----
    if (settings.milestoneStep && !settings.milestoneDisabled) {
      const milestone = checkMilestone(price, settings.milestoneStep, state.lastMilestone);
      if (milestone) {
        await coinStateDb.setLastMilestone(channel.id, coin.symbol, milestone.level);
        if (!milestone.seedOnly && !quietNow) {
          // eslint-disable-next-line no-await-in-loop
          const confirmed = await marketData.confirmPrice(coin.symbol, price);
          if (confirmed) {
            const isBigMilestone = Math.abs(milestone.level / (settings.milestoneStep * 10)) % 1 < 1e-9;
            // eslint-disable-next-line no-await-in-loop
            await deliverAlert(bot, channel, 'milestone', {
              coin, symbol: coin.symbol, price, direction: milestone.direction, milestoneLevel: milestone.level, isBigMilestone,
            });
          } else {
            logger.warn('Milestone sanity check failed — suppressed a likely false alert', { symbol: coin.symbol, channelId: channel.id, price });
          }
        }
      }
    }

    // ---- Threshold check ----
    if (state.lastAlertPrice === null || state.lastAlertPrice === undefined) {
      // eslint-disable-next-line no-await-in-loop
      const seeded = await coinStateDb.seedBaselineIfMissing(channel.id, coin.symbol, price);
      if (seeded) continue; // eslint-disable-line no-continue
    }
    if (quietNow) continue; // eslint-disable-line no-continue

    const cooldownMinutes = settings.cooldownMinutes ?? config.DEFAULT_COOLDOWN_MINUTES;
    if (cooldownActive(state.lastAlertAt, cooldownMinutes)) continue; // eslint-disable-line no-continue

    const { qualifies, changeUsd, changePct } = qualifiesForThreshold(price, state.lastAlertPrice, settings.thresholdType, settings.thresholdValue);
    if (!qualifies) continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    await coinStateDb.recordAlert(channel.id, coin.symbol, price);
    const direction = changeUsd >= 0 ? 'up' : 'down';
    // eslint-disable-next-line no-await-in-loop
    await deliverAlert(bot, channel, 'threshold', { coin, symbol: coin.symbol, price, direction, changePct });
  }
}

async function tick(bot) {
  let channels;
  try {
    channels = await channelsDb.getActiveChannels();
  } catch (err) {
    logger.error('Poller could not load channels', { message: err.message });
    return;
  }
  for (const channel of channels) {
    // eslint-disable-next-line no-await-in-loop
    try {
      await tickChannel(bot, channel);
    } catch (err) {
      logger.error('Poller tick failed for channel', { channelId: channel.id, message: err.message });
      if (err.shouldNotifyAdmin) {
        // eslint-disable-next-line no-await-in-loop
        await adminNotify.notifyAdmin(bot, `⚠️ ${err.sourceName} has failed repeatedly. Alerts may be degraded until it recovers.`);
      }
    }
  }
}

module.exports = { tick, checkMilestone, qualifiesForThreshold, isWithinQuietHours };
