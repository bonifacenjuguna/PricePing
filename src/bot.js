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
const memoryWatchdog = require('./services/memoryWatchdog');
const heartbeatWatchdog = require('./services/heartbeatWatchdog');

const bot = new Telegraf(config.botToken);
telegramSender.init(bot);

bot.use(ownerGate());

bot.start(startHandler.handleStart);
callbacks.register(bot);
bot.on('text', textInput.handleText);

bot.catch((err, ctx) => {
  logger.error('Unhandled error in bot update', { message: err.message, updateType: ctx.updateType });
});

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

  memoryWatchdog.init(bot);
  heartbeatWatchdog.init(bot);
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
