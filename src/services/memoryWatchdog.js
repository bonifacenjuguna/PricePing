// Adaptive memory watchdog. Checks RSS against a configurable ceiling
// (comfortably under Railway's actual container limit) and triggers the
// SAME clean shutdown path as a real SIGTERM when crossed — never a raw
// crash. Cadence adapts: fast checks for the first 2 minutes after boot
// and whenever RSS is within 20% of the ceiling (danger zone), slower
// otherwise — so a sudden spike gets caught quickly without polling
// constantly during normal, healthy operation.
const config = require('../config');
const logger = require('../lib/logger');

const FAST_INTERVAL_MS = 5000;
const BOOT_GRACE_MS = 2 * 60 * 1000;
const DANGER_ZONE_RATIO = 0.8; // RSS within 20% of ceiling
const WARNING_RATIO = 0.8;
const WARNING_LOG_INTERVAL_MS = 60 * 1000;

let lastWarningAt = 0;

function start(onCeilingCrossed) {
  const bootTime = Date.now();
  const ceilingBytes = config.MEMORY_WATCHDOG_MB * 1024 * 1024;

  function checkOnce() {
    const rss = process.memoryUsage().rss;
    const ratio = rss / ceilingBytes;

    if (ratio >= 1) {
      logger.error('Memory ceiling crossed — triggering clean shutdown', {
        rssMb: Math.round(rss / 1024 / 1024),
        ceilingMb: config.MEMORY_WATCHDOG_MB,
      });
      onCeilingCrossed();
      return; // stop scheduling further checks; shutdown is in progress
    }

    if (ratio >= WARNING_RATIO && Date.now() - lastWarningAt > WARNING_LOG_INTERVAL_MS) {
      lastWarningAt = Date.now();
      logger.warn('Memory approaching ceiling', { rssMb: Math.round(rss / 1024 / 1024), ceilingMb: config.MEMORY_WATCHDOG_MB, ratio: ratio.toFixed(2) });
    }

    const inBootGrace = Date.now() - bootTime < BOOT_GRACE_MS;
    const inDangerZone = ratio >= DANGER_ZONE_RATIO;
    const nextInterval = inBootGrace || inDangerZone ? FAST_INTERVAL_MS : config.MEMORY_WATCHDOG_CHECK_INTERVAL_MS;
    setTimeout(checkOnce, nextInterval);
  }

  setTimeout(checkOnce, FAST_INTERVAL_MS);
}

module.exports = { start };
