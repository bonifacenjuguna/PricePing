const config = require('../config');
const logger = require('../utils/logger');
const poller = require('./poller');

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
      timeoutHandle = setTimeout(() => loop(bot), config.pollIntervalMs);
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
