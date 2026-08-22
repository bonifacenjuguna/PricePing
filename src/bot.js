const express = require('express');
const { Telegraf } = require('telegraf');

const config = require('./config');
const logger = require('./utils/logger');

const { accessGate } = require('./handlers/middleware');
const commands = require('./handlers/commands');
const callbacks = require('./handlers/callbacks');
const text = require('./handlers/text');

const settingsDb = require('./db/settings');
const eventsDb = require('./db/events');

const scheduler = require('./services/scheduler');
const memoryWatchdog = require('./services/memoryWatchdog');

const { pool } = require('./db/pool');
const { redis } = require('./db/redis');

const bot = new Telegraf(config.botToken);

// --- Access control: every update must be from the configured admin ---
bot.use(accessGate());

// --- Commands ---
bot.start(commands.start);
bot.help(commands.help);
bot.command('status', commands.home);
bot.command('prices', commands.pricesCmd);
bot.command('thresholds', commands.thresholdsCmd);
bot.command('setthreshold', commands.setThreshold);
bot.command('pause', commands.pause);
bot.command('resume', commands.resume);
bot.command('test', commands.testAlert);

// --- Inline button taps ---
bot.on('callback_query', callbacks.onCallback);

// --- Persistent bottom keyboard (BBTB) taps + anything else typed ---
bot.on('text', text.onText);

bot.catch((err, ctx) => {
  logger.error('Unhandled Telegraf error', { message: err.message, update: ctx.updateType });
});

// ---------------------------------------------------------------------------
// One-time channel announcement — sent once, ever, tracked via a Postgres
// flag so restarts never repeat it. Deliberately doesn't reference "the
// bot" — reads as a channel-owner announcement.
// ---------------------------------------------------------------------------
async function sendAnnouncementIfNeeded() {
  const alreadySent = await settingsDb.isAnnouncementSent();
  if (alreadySent) return;

  const coinList = config.coins.map((c) => c.symbol).join(', ');
  const message =
    `\uD83D\uDCE1 *PricePing is live*\n` +
    `This channel now delivers real-time price alerts for ${coinList} \u2014 ` +
    `the moment a significant move happens.\n\n` +
    `Stay tuned. \uD83D\uDD14`;

  try {
    await bot.telegram.sendMessage(config.channelId, message, { parse_mode: 'Markdown' });
    await settingsDb.markAnnouncementSent();
    logger.info('Sent one-time channel announcement');
  } catch (err) {
    logger.error('Failed to send channel announcement', { message: err.message });
  }
}

// ---------------------------------------------------------------------------
// HTTP server: webhook endpoint + a plain health check for Railway.
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => res.status(200).send('ok'));

async function start() {
  await eventsDb.record('boot', 'Process starting');

  if (config.webhookUrl) {
    const path = config.webhookPath;
    app.use(bot.webhookCallback(path, { secretToken: config.webhookSecret || undefined }));
    await bot.telegram.setWebhook(`${config.webhookUrl}${path}`, {
      secret_token: config.webhookSecret || undefined,
    });
    logger.info(`Webhook set to ${config.webhookUrl}${path}`);
  } else {
    logger.info('No WEBHOOK_URL set — falling back to long-polling (local dev only)');
    await bot.launch();
  }

  app.listen(config.port, () => {
    logger.info(`HTTP server listening on port ${config.port}`);
  });

  await sendAnnouncementIfNeeded();

  scheduler.init(bot);
  memoryWatchdog.init(bot);

  logger.info('PricePing is running');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  scheduler.stop();
  try {
    bot.stop(signal);
  } catch {
    /* non-fatal */
  }
  try {
    await pool.end();
  } catch {
    /* non-fatal */
  }
  try {
    redis.disconnect();
  } catch {
    /* non-fatal */
  }
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.error('Fatal error during startup', { message: err.message, stack: err.stack });
  process.exit(1);
});
