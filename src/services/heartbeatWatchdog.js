const config = require('../config');
const logger = require('../utils/logger');
const heartbeatDb = require('../db/heartbeat');
const events = require('../db/events');
const settingsDb = require('../db/settings');

let timeoutHandle = null;
let stopped = false;
let alreadyNotified = false;

// Catches the failure mode memoryWatchdog can't: the process is alive and
// healthy on memory, but the poll loop itself has silently died (e.g. an
// unawaited rejection slipping past scheduler.js's try/catch in some future
// edit). Checks the heartbeat row poller.js touches every tick; if it's
// gone stale relative to how often it should be updating, DMs the admin.
//
// Self-rescheduling (setTimeout, not setInterval) so both the check
// interval and the stale multiplier are read fresh every cycle from
// db/settings.js's live runtime limits — a change from /limits takes
// effect on the next cycle, no restart needed. Same pattern as
// scheduler.js's poll loop.
async function runCheck(bot) {
  if (stopped) return;

  let lastTickAt;
  try {
    ({ lastTickAt } = await heartbeatDb.get());
  } catch (err) {
    logger.warn('Heartbeat check could not read from DB', { message: err.message });
  }

  const [pollIntervalMs, checkIntervalMs, staleMultiplier] = await Promise.all([
    settingsDb.getRuntimeLimit('pollIntervalMs', config.pollIntervalMs),
    settingsDb.getRuntimeLimit('heartbeatCheckIntervalMs', config.heartbeatCheckIntervalMs),
    settingsDb.getRuntimeLimit('heartbeatStaleMultiplier', config.heartbeatStaleMultiplier),
  ]).catch(() => [config.pollIntervalMs, config.heartbeatCheckIntervalMs, config.heartbeatStaleMultiplier]);

  if (lastTickAt) {
    const staleAfterMs = pollIntervalMs * staleMultiplier;
    const ageMs = Date.now() - new Date(lastTickAt).getTime();

    if (ageMs < staleAfterMs) {
      alreadyNotified = false;
    } else if (!alreadyNotified) {
      alreadyNotified = true;
      const ageMinutes = Math.round(ageMs / 60000);
      logger.error(`Poller heartbeat stale: last tick ${ageMinutes}m ago`);
      await events.record('heartbeat_stale', `No poll tick in ${ageMinutes}m — poller may be stuck`).catch(() => {});
      try {
        await bot.telegram.sendMessage(
          config.adminId,
          `\u26A0\uFE0F Heads up: the price poller hasn't completed a tick in ${ageMinutes} minutes ` +
            `(expected every ${pollIntervalMs / 1000}s). It may be stuck — worth checking the logs ` +
            `or restarting the service if this doesn't clear on its own.`
        );
      } catch (err) {
        logger.warn('Could not notify admin of stale heartbeat', { message: err.message });
      }
    }
  }

  if (!stopped) {
    timeoutHandle = setTimeout(() => runCheck(bot), checkIntervalMs);
  }
}

function init(bot) {
  stopped = false;
  timeoutHandle = setTimeout(() => runCheck(bot), config.heartbeatCheckIntervalMs);
}

function stop() {
  stopped = true;
  if (timeoutHandle) clearTimeout(timeoutHandle);
}

module.exports = { init, stop };
