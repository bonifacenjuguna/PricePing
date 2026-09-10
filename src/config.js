// Central config. Reads env vars once, validates required ones, hard-exits
// on missing config so a broken deploy fails fast and loud at boot instead
// of failing weirdly three requests in. Everything else in the app reads
// from here, never from process.env directly (except prepare-assets.js,
// which deliberately avoids this file — see scripts/prepare-assets.js).
require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: missing required env var ${name}`);
    process.exit(1);
  }
  return val;
}

function optionalInt(name, fallback) {
  const val = process.env[name];
  return val ? parseInt(val, 10) : fallback;
}

const NODE_ENV = process.env.NODE_ENV || 'production';
const isProd = NODE_ENV === 'production';

module.exports = {
  NODE_ENV,
  isProd,

  // Telegram
  BOT_TOKEN: required('BOT_TOKEN'),
  ADMIN_ID: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : null,
  BASE_URL: process.env.BASE_URL || null, // required in prod (webhook), checked below
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || null,

  // Infra
  PORT: optionalInt('PORT', 3000),
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: required('REDIS_URL'),

  // Ops / watchdog
  MEMORY_WATCHDOG_MB: optionalInt('MEMORY_WATCHDOG_MB', 450),
  MEMORY_WATCHDOG_CHECK_INTERVAL_MS: optionalInt('MEMORY_WATCHDOG_CHECK_INTERVAL_MS', 30000),

  // Polling / alert cadence
  POLL_INTERVAL_MS: optionalInt('POLL_INTERVAL_MS', 20000),
  DIGEST_CHECK_INTERVAL_MS: optionalInt('DIGEST_CHECK_INTERVAL_MS', 60000),
  DEFAULT_COOLDOWN_MINUTES: optionalInt('DEFAULT_COOLDOWN_MINUTES', 15),

  // Card rendering
  SUPERSAMPLE: optionalInt('CARD_SUPERSAMPLE', 3),

  logosDir: require('path').join(__dirname, 'assets', 'logos'),
  fontsDir: require('path').join(__dirname, 'assets', 'fonts'),
};

if (isProd && !module.exports.BASE_URL) {
  // eslint-disable-next-line no-console
  console.error('FATAL: BASE_URL is required in production (used for the Telegram webhook URL)');
  process.exit(1);
}
