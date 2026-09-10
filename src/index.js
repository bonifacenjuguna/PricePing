const config = require('./config');
const logger = require('./lib/logger');
const { migrate } = require('./db/migrate');
const postgres = require('./db/postgres');
const redisDb = require('./db/redis');
const { syncLogosToDisk } = require('./services/logoSync');
const { syncFontsToDisk } = require('./services/fontSync');
const marketData = require('./services/marketData');
const memoryWatchdog = require('./services/memoryWatchdog');
const poller = require('./services/poller');
const digestScheduler = require('./services/digestScheduler');
const { createBot } = require('./bot');
const { createApp } = require('./server/app');

const SHUTDOWN_STEP_TIMEOUT_MS = 5000;
const SHUTDOWN_HARD_DEADLINE_MS = 15000;

let bot = null;
let httpServer = null;
let pollTimer = null;
let digestTimer = null;
let shuttingDown = false;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => {
      logger.warn('Shutdown step timed out, continuing anyway', { step: label });
      resolve();
    }, ms)),
  ]);
}

// Used by every exit path: SIGTERM, SIGINT, the memory watchdog, and
// uncaughtException. Idempotent, wrapped in a hard deadline so a hung step
// (httpServer.close() waiting on a keep-alive connection, redis.quit()
// hanging in a bad reconnect state — both documented gotchas) can't leave
// the process alive for Railway to eventually SIGKILL after piling up more
// memory in the meantime.
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { reason });

  const hardDeadline = setTimeout(() => {
    logger.error('Shutdown hard deadline exceeded — forcing exit', { reason });
    process.exit(1);
  }, SHUTDOWN_HARD_DEADLINE_MS);
  hardDeadline.unref();

  if (pollTimer) clearInterval(pollTimer);
  if (digestTimer) clearInterval(digestTimer);

  if (bot && !config.isProd) {
    // Only meaningful in polling mode — in webhook mode bot.stop() throws
    // pointlessly since there's no active polling loop to stop.
    await withTimeout(Promise.resolve(bot.stop(reason)), SHUTDOWN_STEP_TIMEOUT_MS, 'bot.stop');
  }
  if (httpServer) {
    await withTimeout(new Promise((resolve) => httpServer.close(resolve)), SHUTDOWN_STEP_TIMEOUT_MS, 'http.close');
  }
  await withTimeout(redisDb.close(), SHUTDOWN_STEP_TIMEOUT_MS, 'redis.close');
  await withTimeout(postgres.close(), SHUTDOWN_STEP_TIMEOUT_MS, 'postgres.close');

  clearTimeout(hardDeadline);
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  // Logged only, no restart — most unhandled rejections are already caught
  // one level up (e.g. a source adapter's own try/catch); a bare log here
  // is visibility without an over-eager restart on something benign.
  logger.error('Unhandled rejection', { reason: reason && reason.message ? reason.message : String(reason) });
});

async function main() {
  logger.info('Booting', { env: config.NODE_ENV });

  await migrate();
  logger.info('Migrations applied');

  await redisDb.connect();

  await syncLogosToDisk();
  await syncFontsToDisk();

  const selfCheck = await marketData.selfCheckAllSources();
  logger.info('Boot self-check complete', selfCheck);
  const failedSources = Object.entries(selfCheck).filter(([, v]) => v !== 'ok');
  if (failedSources.length) {
    logger.warn('Some data sources failed the boot self-check', { failed: failedSources.map(([k]) => k) });
  }

  bot = createBot();

  const app = createApp();
  httpServer = app.listen(config.PORT, () => {
    logger.info('Server listening (health check)', { port: config.PORT });
  });

  if (config.isProd) {
    const webhookPath = `/telegraf/${config.BOT_TOKEN}`;
    app.use(bot.webhookCallback(webhookPath, { secretToken: config.TELEGRAM_WEBHOOK_SECRET || undefined }));
    await bot.telegram.setWebhook(`${config.BASE_URL}${webhookPath}`, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET || undefined,
      drop_pending_updates: true,
    });
    logger.info('Webhook set', { url: `${config.BASE_URL}${webhookPath}` });
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    bot.launch({ dropPendingUpdates: true });
    logger.info('Bot launched in polling mode (dev)');
  }

  pollTimer = setInterval(() => {
    poller.tick(bot).catch((err) => logger.error('Poller tick threw', { message: err.message }));
  }, config.POLL_INTERVAL_MS);

  digestTimer = setInterval(() => {
    digestScheduler.tick(bot).catch((err) => logger.error('Digest scheduler tick threw', { message: err.message }));
  }, config.DIGEST_CHECK_INTERVAL_MS);

  memoryWatchdog.start(() => shutdown('memory-ceiling'));

  logger.info('Boot complete');
}

main().catch((err) => {
  logger.error('Fatal boot error', { message: err.message, stack: err.stack });
  process.exit(1);
});
