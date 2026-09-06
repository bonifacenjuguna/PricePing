const config = require('../config');
const logger = require('../utils/logger');
const events = require('../db/events');

let intervalHandle = null;

// Same design as the original: warn, log an audit event, DM the admin,
// then exit(1) so Railway's restartPolicy (see railway.json,
// ON_FAILURE / max 10 retries) relaunches us cleanly — a controlled
// restart on our terms beats waiting for Railway's OOM killer to do it
// on theirs.
//
// One real fix vs. the original: measures `rss` (total resident memory —
// what Railway's container limit actually checks against), not
// `heapUsed` (V8 heap only). sharp's image buffers for logo/card/chart
// rendering live in native memory OUTSIDE the V8 heap, so heapUsed alone
// was blind to the single biggest memory consumer in this bot.
function init(bot) {
  const limitBytes = config.memoryLimitMb * 1024 * 1024;
  const warnBytes = limitBytes * config.memoryWarnRatio;

  intervalHandle = setInterval(async () => {
    const usage = process.memoryUsage();
    if (usage.rss < warnBytes) return;

    const usedMb = Math.round(usage.rss / 1024 / 1024);
    logger.warn(`Memory usage high: ${usedMb}MB / ${config.memoryLimitMb}MB limit (rss)`);

    await events.record('memory_restart', `RSS at ${usedMb}MB, restarting gracefully`);

    try {
      await bot.telegram.sendMessage(
        config.adminId,
        `⚠️ Memory watchdog: RSS hit ${usedMb}MB of the ${config.memoryLimitMb}MB limit. ` +
          `Restarting now to stay healthy — back in a few seconds.`
      );
    } catch (err) {
      logger.warn('Could not notify admin before memory restart', { message: err.message });
    }

    clearInterval(intervalHandle);
    process.exit(1);
  }, config.memoryCheckIntervalMs);
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = { init, stop };
