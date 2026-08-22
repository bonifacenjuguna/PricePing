require('dotenv').config();

const { coins, defaultThresholds } = require('./coins');

function required(name) {
  const val = process.env[name];
  if (!val) {
    // eslint-disable-next-line no-console
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

// Coin list and default thresholds live in ./coins.js — that module has no
// environment/config dependencies, so it can also be required directly by
// build-time scripts (e.g. scripts/prepare-assets.js) without needing
// DATABASE_URL, REDIS_URL, or any other runtime secrets.

module.exports = {
  botToken: required('BOT_TOKEN'),
  botName: process.env.BOT_NAME || 'PricePing',
  adminId: Number(required('ADMIN_TELEGRAM_ID')),
  adminName: process.env.ADMIN_NAME || 'Admin',
  channelId: required('CHANNEL_ID'), // e.g. @PricePing or -100xxxxxxxxxx

  webhookUrl: process.env.WEBHOOK_URL || null,
  webhookPath: process.env.WEBHOOK_PATH || '/telegram-webhook',
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  port: Number(process.env.PORT) || 3000,

  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),

  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 30000,
  cooldownMinutes: Number(process.env.COOLDOWN_MINUTES) || 5,
  binanceFailureAlertThreshold: Number(process.env.BINANCE_FAILURE_ALERT_THRESHOLD) || 10,

  memoryLimitMb: Number(process.env.MEMORY_LIMIT_MB) || 220,
  memoryCheckIntervalMs: Number(process.env.MEMORY_CHECK_INTERVAL_MS) || 60000,
  memoryWarnRatio: Number(process.env.MEMORY_WARN_RATIO) || 0.8,

  sendDelayMs: Number(process.env.SEND_DELAY_MS) || 250,
  telegramSendRetries: 1,

  coins,
  defaultThresholds,

  assetsDir: require('path').join(__dirname, 'assets'),
  logosDir: require('path').join(__dirname, 'assets', 'logos'),
};
