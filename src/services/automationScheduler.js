const logger = require('../utils/logger');
const schedulesDb = require('../db/schedules');
const settingsDb = require('../db/settings');
const actions = require('./actions');
const digest = require('./digest');
const { isWithinQuietHours } = require('./poller');

// Checked every 5 minutes, same pattern as digest.js — deliberately not
// tied to POLL_INTERVAL_MS so alert-tick timing changes never affect
// automation timing.
let intervalHandle = null;

function bucket5(minute) {
  return Math.floor(minute / 5) * 5;
}

// Returns whether `schedule` should fire right now, and the dedupe key to
// store afterward so a 5-minute check loop never double-fires within the
// same hour/day/week window.
function computeDue(schedule, now) {
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  const dateStr = now.toISOString().slice(0, 10);
  const minuteMatches = bucket5(minute) === bucket5(schedule.atMinuteUtc || 0);

  if (schedule.cadence === 'hourly') {
    const runKey = `${dateStr}T${String(hour).padStart(2, '0')}`;
    return { due: minuteMatches && schedule.lastRunKey !== runKey, runKey };
  }
  if (schedule.cadence === 'daily') {
    const runKey = dateStr;
    return { due: hour === schedule.atHourUtc && minuteMatches && schedule.lastRunKey !== runKey, runKey };
  }
  if (schedule.cadence === 'weekly') {
    const runKey = dateStr;
    return {
      due: day === schedule.dayOfWeek && hour === schedule.atHourUtc && minuteMatches && schedule.lastRunKey !== runKey,
      runKey,
    };
  }
  return { due: false, runKey: null };
}

async function checkAndRun(bot) {
  let schedules;
  try {
    schedules = await schedulesDb.getEnabled();
  } catch (err) {
    logger.warn('Could not load schedules', { message: err.message });
    return;
  }

  const now = new Date();
  const quietHours = await settingsDb.getQuietHours().catch(() => null);
  const quietNow = isWithinQuietHours(quietHours, now);

  for (const schedule of schedules) {
    const { due, runKey } = computeDue(schedule, now);
    if (!due) continue;
    // Digests are exempt — the admin already picked a specific hour for
    // them on purpose; post/chart schedules hold during quiet hours and
    // simply wait for their next scheduled slot (no catch-up needed,
    // since they're not tracking a missed price move the way alerts are).
    if (quietNow && schedule.kind !== 'digest') continue;

    try {
      let result;
      if (schedule.kind === 'post') {
        result = await actions.postPriceUpdate(bot.telegram, schedule.symbol, schedule.channelName);
      } else if (schedule.kind === 'chart') {
        result = await actions.postChartAction(bot.telegram, schedule.symbol, schedule.period || '24h', schedule.channelName);
      } else if (schedule.kind === 'digest') {
        const ok = await digest.sendDigestToChannel(bot.telegram, schedule.channelName);
        result = { ok, message: ok ? 'digest sent' : 'digest send failed' };
      }
      if (result && !result.ok) {
        logger.warn(`Schedule ${schedule.id} ran but failed`, { message: result.message });
      }
      await schedulesDb.markRun(schedule.id, runKey);
    } catch (err) {
      logger.warn(`Schedule ${schedule.id} threw`, { message: err.message });
    }
  }
}

function init(bot) {
  intervalHandle = setInterval(() => {
    checkAndRun(bot).catch((err) => logger.error('Automation scheduler check failed', { message: err.message }));
  }, 5 * 60 * 1000);
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = { init, stop, computeDue };
