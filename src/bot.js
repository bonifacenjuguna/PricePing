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
const channelsDb = require('./db/channels');
const alertsLogDb = require('./db/alertsLog');

const scheduler = require('./services/scheduler');
const memoryWatchdog = require('./services/memoryWatchdog');
const heartbeatWatchdog = require('./services/heartbeatWatchdog');
const automationScheduler = require('./services/automationScheduler');
const coinRegistry = require('./services/coinRegistry');
const cardRenderer = require('./services/cardRenderer');

const { pool } = require('./db/pool');
const { redis } = require('./db/redis');

const bot = new Telegraf(config.botToken);

// --- Access control: every update must be from the configured admin ---
bot.use(accessGate());

// Lightweight usage tracking — records which slash commands actually get
// used, purely for the admin's own curiosity via /usage. Never blocks the
// real handler and never throws into the update pipeline.
const commandUsageDb = require('./db/commandUsage');
bot.use(async (ctx, next) => {
  const text = ctx.message && ctx.message.text;
  if (typeof text === 'string' && text.startsWith('/')) {
    const command = text.slice(1).split(/[\s@]/)[0].toLowerCase();
    if (command) commandUsageDb.increment(command).catch(() => {});
  }
  return next();
});

// --- Commands ---
bot.start(commands.start);
bot.help(commands.help);
bot.command('commands', commands.hubCmd);
bot.command('status', commands.home);
bot.command('prices', commands.pricesCmd);
bot.command('post', commands.postCmd);
bot.command('chart', commands.chartCmd);
bot.command('postchart', commands.postChartCmd);
bot.command('thresholds', commands.thresholdsCmd);
bot.command('setthreshold', commands.setThreshold);
bot.command('pause', commands.pause);
bot.command('resume', commands.resume);
bot.command('quiethours', commands.quietHoursCmd);
bot.command('cardstyle', commands.cardStyleCmd);
bot.command('mute', commands.mute);
bot.command('unmute', commands.unmute);
bot.command('milestones', commands.milestonesCmd);
bot.command('setmilestone', commands.setMilestoneCmd);
bot.command('setcooldown', commands.setCooldownCmd);
bot.command('resetcooldown', commands.resetCooldownCmd);
bot.command('addcoin', commands.addCoinCmd);
bot.command('removecoin', commands.removeCoinCmd);
bot.command('coins', commands.coinListScreen);
bot.command('history', commands.historyCmd);
bot.command('stats', commands.statsCmd);
bot.command('settings', commands.settingsCmd);
bot.command('channels', commands.channelsListCmd);
bot.command('addchannel', commands.addChannelCmd);
bot.command('removechannel', commands.removeChannelCmd);
bot.command('setdefaultchannel', commands.setDefaultChannelCmd);
bot.command('cleardefaultchannel', commands.clearDefaultChannelTypeCmd);
bot.command('setcaption', commands.setCaptionCmd);
bot.command('applycaptionpack', commands.applyCaptionPackCmd);
bot.command('previewcaption', commands.previewCaptionCmd);
bot.command('resetcaption', commands.resetCaptionCmd);
bot.command('variables', commands.variablesCmd);
bot.command('setvar', commands.setVarCmd);
bot.command('delvar', commands.delVarCmd);
bot.command('schedule', commands.scheduleCmd);
bot.command('schedules', commands.schedulesListCmd);
bot.command('addrule', commands.ruleCmd);
bot.command('rules', commands.rulesListCmd);
bot.command('movers', commands.moversCmd);
bot.command('tag', commands.tagCmd);
bot.command('untag', commands.untagCmd);
bot.command('tags', commands.tagsCmd);
bot.command('broadcast', commands.broadcastCmd);
bot.command('exportconfig', commands.exportConfigCmd);
bot.command('importconfig', commands.importConfigCmd);
bot.command('reset', commands.resetCmd);
bot.command('test', commands.testAlert);
bot.command('whoami', commands.whoami);
bot.command('usage', commands.usageCmd);
bot.command('auditlog', commands.auditLogCmd);
bot.command('digestnow', commands.digestNowCmd);

// --- Inline button taps ---
bot.on('callback_query', callbacks.onCallback);

// --- Persistent bottom keyboard (BBTB) taps + guided input + bare symbols + anything else typed ---
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
// Registers the slash-command menu with Telegram (the list that pops up
// when the admin types "/" in the chat). Safe to call on every boot —
// setMyCommands just overwrites whatever was registered before. /start is
// deliberately first — it's the natural entry point for anyone opening the
// chat for the first time. Kept to a curated, most-used subset — every
// command is still callable even if it's not in this popup list (see the
// bot.command(...) registrations above, and /help for the complete list).
// ---------------------------------------------------------------------------
async function registerBotCommands() {
  const commandList = [
    { command: 'start', description: 'Welcome + main menu' },
    { command: 'commands', description: 'Open the full button-driven control panel' },
    { command: 'status', description: 'Bot status, uptime, and alerts today' },
    { command: 'prices', description: 'Current price for every tracked coin' },
    { command: 'post', description: 'Post a price update to a channel now' },
    { command: 'chart', description: 'Send yourself a price chart' },
    { command: 'thresholds', description: 'View all alert thresholds' },
    { command: 'setthreshold', description: 'Change a threshold: SYMBOL AMOUNT [pct]' },
    { command: 'pause', description: 'Stop posting alerts (optionally: /pause 2h)' },
    { command: 'resume', description: 'Resume posting alerts' },
    { command: 'mute', description: 'Silence one coin: SYMBOL [duration]' },
    { command: 'channels', description: 'List registered channels' },
    { command: 'variables', description: 'List caption variables' },
    { command: 'test', description: 'Advanced test menu' },
    { command: 'help', description: 'Show the full command list' },
  ];

  try {
    await bot.telegram.setMyCommands(commandList);
    logger.info('Registered bot command menu with Telegram');
  } catch (err) {
    logger.warn('Could not register bot command menu', { message: err.message });
  }
}

// ---------------------------------------------------------------------------
// Startup self-test: renders one card fully in memory (never sent anywhere)
// to confirm the font/sharp/logo pipeline actually works before the first
// real alert silently depends on it. DMs the admin if it fails so a broken
// image pipeline is caught at boot, not at 3am when BTC finally moves.
// ---------------------------------------------------------------------------
async function selfTestRenderPipeline() {
  try {
    const sampleCoin = config.coins[0];
    await cardRenderer.renderCard({
      coin: sampleCoin,
      price: 100,
      changeUsd: 1,
      changePct: 1,
      direction: 'up',
      alertType: 'threshold',
    });
    logger.info('Startup self-test: card render pipeline OK');
  } catch (err) {
    logger.error('Startup self-test FAILED — card rendering is broken', { message: err.message });
    await eventsDb.record('selftest_failed', err.message);
    try {
      await bot.telegram.sendMessage(
        config.adminId,
        `\u26A0\uFE0F Startup self-test failed: card rendering is broken (${err.message}). ` +
          `Alerts will likely fail to send until this is fixed.`
      );
    } catch {
      /* non-fatal — if we can't even DM the admin, logging is all we have */
    }
  }
}

// Boot-time sanity check: a default channel must exist for automatic
// alerts to have anywhere to go. migrate.js seeds one from CHANNEL_ID on
// every deploy, so this should never actually fire in normal operation —
// it's here so a skipped migration step fails loudly instead of silently.
async function checkDefaultChannel() {
  const defaultChannel = await channelsDb.getDefault();
  if (!defaultChannel) {
    logger.error('No default channel found in the database — did you run `npm run migrate`? Automatic alerts have nowhere to go.');
    await eventsDb.record('no_default_channel', 'Boot check found no default channel configured');
  }
}

// ---------------------------------------------------------------------------
// HTTP server: webhook endpoint + a plain health check for Railway.
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => res.status(200).send('ok'));

// Read-only JSON feed of recent alerts — lets the admin (or anyone with
// the URL) syndicate PricePing data elsewhere without needing bot access
// at all. No auth: this only ever exposes what's already public in the
// channel(s), never admin settings or channel chat_ids.
app.get('/feed.json', async (req, res) => {
  try {
    const recent = await alertsLogDb.recent(20);
    res.json({
      bot: config.botName,
      generatedAt: new Date().toISOString(),
      alerts: recent.map((r) => ({
        symbol: r.symbol,
        price: Number(r.price),
        changeUsd: Number(r.change_usd),
        direction: r.direction,
        alertType: r.alert_type,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    logger.error('Failed to build /feed.json', { message: err.message });
    res.status(500).json({ error: 'internal error' });
  }
});

async function start() {
  await eventsDb.record('boot', 'Process starting');

  // Must happen before the scheduler starts and before commands can be
  // used — anything added via /addcoin in a previous session needs to be
  // back in config.coins before the poller's first tick.
  await coinRegistry.loadCustomCoins();

  await checkDefaultChannel();
  await selfTestRenderPipeline();

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

  await registerBotCommands();
  await sendAnnouncementIfNeeded();

  scheduler.init(bot);
  memoryWatchdog.init(bot);
  heartbeatWatchdog.init(bot);
  automationScheduler.init(bot);

  logger.info(`PricePing v${require('../package.json').version} is running`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  scheduler.stop();
  heartbeatWatchdog.stop();
  automationScheduler.stop();
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
