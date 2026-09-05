const config = require('../config');
const logger = require('../utils/logger');
const events = require('../db/events');
const settingsDb = require('../db/settings');

let timeoutHandle = null;
let stopped = false;

// Self-rescheduling so the memory limit (see /limits) can be raised or
// lowered live — the next check picks up the new value, no restart
// needed. warnRatio/checkInterval stay on config.js for now (not exposed
// as a runtime limit yet).
async function runCheck(bot) {
  if (stopped) return;

  const limitMb = await settingsDb.getRuntimeLimit('memoryLimitMb', config.memoryLimitMb).catch(() => config.memoryLimitMb);
  const limitBytes = limitMb * 1024 * 1024;
  const warnBytes = limitBytes * config.memoryWarnRatio;

  const usage = process.memoryUsage();
  if (usage.heapUsed >= warnBytes) {
    const usedMb = Math.round(usage.heapUsed / 1024 / 1024);
    logger.warn(`Memory usage high: ${usedMb}MB / ${limitMb}MB limit`);

    await events.record('memory_restart', `Heap at ${usedMb}MB, restarting gracefully`).catch(() => {});

    try {
      await bot.telegram.sendMessage(
        config.adminId,
        `Memory watchdog: heap hit ${usedMb}MB of the ${limitMb}MB limit. ` +
          `Restarting now to stay healthy — back in a few seconds.`
      );
    } catch (err) {
      logger.warn('Could not notify admin before memory restart', { message: err.message });
    }

    // Let Railway (or any process manager) restart us cleanly.
    stopped = true;
    process.exit(1);
    return;
  }

  if (!stopped) {
    timeoutHandle = setTimeout(() => runCheck(bot), config.memoryCheckIntervalMs);
  }
}

function init(bot) {
  stopped = false;
  timeoutHandle = setTimeout(() => runCheck(bot), config.memoryCheckIntervalMs);
}

function stop() {
  stopped = true;
  if (timeoutHandle) clearTimeout(timeoutHandle);
}

module.exports = { init, stop };
