const config = require('../config');
const logger = require('../utils/logger');
const poller = require('./poller');
const settingsDb = require('../db/settings');

let stopped = false;
let timeoutHandle = null;

async function loop(bot) {
  if (stopped) return;
  try {
    await poller.tick(bot);
  } catch (err) {
    // A single bad tick should never kill the scheduler — log and keep going.
    logger.error('Unhandled error in poll tick', { message: err.message, stack: err.stack });
  } finally {
    if (!stopped) {
      // Read live every cycle — see db/settings.js's runtime limits. Means
      // a change from /limits takes effect on the very next tick, no
      // restart needed.
      const intervalMs = await settingsDb.getRuntimeLimit('pollIntervalMs', config.pollIntervalMs).catch(() => config.pollIntervalMs);
      timeoutHandle = setTimeout(() => loop(bot), intervalMs);
    }
  }
}

function init(bot) {
  // Kick off the first tick shortly after boot rather than immediately,
  // so the webhook/health server is fully up first.
  timeoutHandle = setTimeout(() => loop(bot), 2000);
}

function stop() {
  stopped = true;
  if (timeoutHandle) clearTimeout(timeoutHandle);
}

module.exports = { init, stop };
