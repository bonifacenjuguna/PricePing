const config = require('../config');
const logger = require('../utils/logger');
const heartbeatDb = require('../db/heartbeat');
const events = require('../db/events');

let intervalHandle = null;
let alreadyNotified = false;

// Catches the failure mode memoryWatchdog can't: the process is alive and
// healthy on memory, but the poll loop itself has silently died (e.g. an
// unawaited rejection slipping past scheduler.js's try/catch in some future
// edit). Checks the heartbeat row poller.js touches every tick; if it's
// gone stale relative to how often it should be updating, DMs the admin.
function init(bot) {
  const staleAfterMs = config.pollIntervalMs * config.heartbeatStaleMultiplier;

  intervalHandle = setInterval(async () => {
    let lastTickAt;
    try {
      ({ lastTickAt } = await heartbeatDb.get());
    } catch (err) {
      logger.warn('Heartbeat check could not read from DB', { message: err.message });
      return;
    }

    if (!lastTickAt) return; // nothing recorded yet, still warming up

    const ageMs = Date.now() - new Date(lastTickAt).getTime();
    if (ageMs < staleAfterMs) {
      alreadyNotified = false;
      return;
    }

    if (alreadyNotified) return;
    alreadyNotified = true;

    const ageMinutes = Math.round(ageMs / 60000);
    logger.error(`Poller heartbeat stale: last tick ${ageMinutes}m ago`);
    await events.record('heartbeat_stale', `No poll tick in ${ageMinutes}m — poller may be stuck`);
    try {
      await bot.telegram.sendMessage(
        config.adminId,
        `\u26A0\uFE0F Heads up: the price poller hasn't completed a tick in ${ageMinutes} minutes ` +
          `(expected every ${config.pollIntervalMs / 1000}s). It may be stuck — worth checking the logs ` +
          `or restarting the service if this doesn't clear on its own.`
      );
    } catch (err) {
      logger.warn('Could not notify admin of stale heartbeat', { message: err.message });
    }
  }, config.heartbeatCheckIntervalMs);
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = { init, stop };
