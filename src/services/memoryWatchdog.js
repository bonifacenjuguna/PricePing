const config = require('../config');
const logger = require('../utils/logger');
const events = require('../db/events');

let intervalHandle = null;

function init(bot) {
  const limitBytes = config.memoryLimitMb * 1024 * 1024;
  const warnBytes = limitBytes * config.memoryWarnRatio;

  intervalHandle = setInterval(async () => {
    const usage = process.memoryUsage();
    if (usage.heapUsed < warnBytes) return;

    const usedMb = Math.round(usage.heapUsed / 1024 / 1024);
    logger.warn(`Memory usage high: ${usedMb}MB / ${config.memoryLimitMb}MB limit`);

    await events.record('memory_restart', `Heap at ${usedMb}MB, restarting gracefully`);

    try {
      await bot.telegram.sendMessage(
        config.adminId,
        `Memory watchdog: heap hit ${usedMb}MB of the ${config.memoryLimitMb}MB limit. ` +
          `Restarting now to stay healthy — back in a few seconds.`
      );
    } catch (err) {
      logger.warn('Could not notify admin before memory restart', { message: err.message });
    }

    // Let Railway (or any process manager) restart us cleanly.
    clearInterval(intervalHandle);
    process.exit(1);
  }, config.memoryCheckIntervalMs);
}

module.exports = { init };
