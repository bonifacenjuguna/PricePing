require('dotenv').config();
const { assetsDir, logosDir } = require('./coins');

function required(name) {
  const val = process.env[name];
  if (!val) {
    // eslint-disable-next-line no-console
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

module.exports = {
  // --- unchanged from earlier versions — same Railway env vars, same names ---
  botToken: required('BOT_TOKEN'),
  botName: process.env.BOT_NAME || 'PricePing',
  adminId: Number(required('ADMIN_TELEGRAM_ID')),
  adminName: process.env.ADMIN_NAME || 'Admin',
  channelId: required('CHANNEL_ID'), // primary channel — e.g. @PricePing or -100xxxxxxxxxx

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

  maxAlertsPerHour: Number(process.env.MAX_ALERTS_PER_HOUR) || 20,

  digestHourUtc: Number(process.env.DIGEST_HOUR_UTC ?? 9),
  digestEnabled: (process.env.DIGEST_ENABLED ?? 'true') === 'true',

  heartbeatCheckIntervalMs: Number(process.env.HEARTBEAT_CHECK_INTERVAL_MS) || 5 * 60 * 1000,
  heartbeatStaleMultiplier: Number(process.env.HEARTBEAT_STALE_MULTIPLIER) || 3,

  defaultMuteMs: 60 * 60 * 1000,

  // --- new in v1.0.0 — additive only, nothing above this line was renamed ---

  // Binance auto-sync replaces manual /addcoin. USDT-quoted, status TRADING
  // pairs only — see services/binanceSync.js.
  binanceQuoteAsset: process.env.BINANCE_QUOTE_ASSET || 'USDT',
  binanceSyncIntervalMs: Number(process.env.BINANCE_SYNC_INTERVAL_MS) || 6 * 60 * 60 * 1000, // 6h

  // Tier assignment — by 24h quote-volume rank across tracked pairs (no
  // paid API needed). Top N = major, next N = mid, everything else micro.
  tierMajorRankMax: Number(process.env.TIER_MAJOR_RANK_MAX) || 10,
  tierMidRankMax: Number(process.env.TIER_MID_RANK_MAX) || 50,

  // Per-tier default alert threshold, as a % move — this is the "Cruise"
  // (1x / Normal) baseline. Bot Mode multiplies this up or down.
  tierMajorThresholdPct: Number(process.env.TIER_MAJOR_THRESHOLD_PCT) || 2,
  tierMidThresholdPct: Number(process.env.TIER_MID_THRESHOLD_PCT) || 4,
  tierMicroThresholdPct: Number(process.env.TIER_MICRO_THRESHOLD_PCT) || 8,

  // Bot Mode — see services/modes.js for the full multiplier table. DB
  // setting (key 'bot_mode') overrides this once the owner has ever
  // switched mode; this env var only matters for a fresh deploy.
  defaultBotMode: process.env.DEFAULT_BOT_MODE || 'cruise',

  // Timezone — DB setting (key 'timezone') overrides this once the owner
  // has set one via the menu; this env var is just the first-boot default.
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'UTC',

  // Automation base intervals (Cruise/1x baseline — Bot Mode scales these).
  chartBaseIntervalMs: Number(process.env.CHART_BASE_INTERVAL_MS) || 4 * 60 * 60 * 1000, // 4h
  moversBaseIntervalMs: Number(process.env.MOVERS_BASE_INTERVAL_MS) || 6 * 60 * 60 * 1000, // 6h
  feargreedBaseIntervalMs: Number(process.env.FEARGREED_BASE_INTERVAL_MS) || 24 * 60 * 60 * 1000, // 24h

  // Anti-Spam mode's extra restriction on top of its 2x threshold/interval
  // multiplier — a hard daily post cap per channel, and Movers automation
  // is skipped entirely (see services/automationScheduler.js).
  antiSpamMaxPostsPerDay: Number(process.env.ANTI_SPAM_MAX_POSTS_PER_DAY) || 12,

  assetsDir,
  logosDir,
};
