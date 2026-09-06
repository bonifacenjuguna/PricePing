const { Telegraf } = require('telegraf');
const express = require('express');

const config = require('./config');
const logger = require('./utils/logger');
const ownerGate = require('./middleware/ownerGate');
const callbacks = require('./handlers/callbacks');
const startHandler = require('./handlers/start');
const textInput = require('./handlers/textInput');
const telegramSender = require('./services/telegramSender');
const binanceSync = require('./services/binanceSync');
const poller = require('./services/poller');
const automationScheduler = require('./services/automationScheduler');

const bot = new Telegraf(config.botToken);
telegramSender.init(bot);

bot.use(ownerGate());

bot.start(startHandler.handleStart);
callbacks.register(bot);
bot.on('text', textInput.handleText);

bot.catch((err, ctx) => {
  logger.error('Unhandled error in bot update', { message: err.message, updateType: ctx.updateType });
});

// --- Memory watchdog --------------------------------------------------------
// Same reasoning as before: a single-owner bot on Railway's free/hobby tier
// has a hard memory ceiling — this logs a warning well before hitting it,
// and force-runs a GC pass if --expose-gc is available, rather than
// waiting for Railway to OOM-kill the process.
function startMemoryWatchdog() {
  setInterval(() => {
    const mem = process.memoryUsage();
    const usedMb = mem.rss / 1024 / 1024;
    const ratio = usedMb / config.memoryLimitMb;
    if (ratio >= config.memoryWarnRatio) {
      logger.warn('Memory usage high', { usedMb: Math.round(usedMb), limitMb: config.memoryLimitMb, ratio: ratio.toFixed(2) });
      if (global.gc) global.gc();
    }
  }, config.memoryCheckIntervalMs);
}

// --- Boot --------------------------------------------------------------------
async function main() {
  const app = express();
  app.use(express.json());
  app.get('/', (_req, res) => res.send('PricePing v1.0.0 is running.'));

  if (config.webhookUrl) {
    app.use(bot.webhookCallback(config.webhookPath, { secretToken: config.webhookSecret || undefined }));
    await bot.telegram.setWebhook(`${config.webhookUrl}${config.webhookPath}`, {
      secret_token: config.webhookSecret || undefined,
    });
    logger.info(`Webhook set to ${config.webhookUrl}${config.webhookPath}`);
  } else {
    await bot.telegram.deleteWebhook().catch(() => {});
    bot.launch();
    logger.info('Bot launched in long-polling mode (no WEBHOOK_URL set).');
  }

  app.listen(config.port, () => logger.info(`HTTP server listening on port ${config.port}`));

  startMemoryWatchdog();
  binanceSync.startSyncSchedule();
  poller.startPolling();
  automationScheduler.startAutomation();

  await startHandler.announceStartup(bot);

  logger.info('PricePing v1.0.0 fully started.');
}

main().catch((err) => {
  logger.error('Fatal startup error', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
