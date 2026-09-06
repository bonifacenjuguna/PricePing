const renderScreen = require('../utils/renderScreen');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const pendingInput = require('../services/pendingInput');
const timezoneService = require('../services/timezoneService');
const modes = require('../services/modes');
const coinsDb = require('../db/coins');
const channelsDb = require('../db/channels');
const { pool } = require('../db/pool');
const { redis } = require('../db/redis');
const config = require('../config');

async function showHub(ctx) {
  await renderScreen(ctx, '🛠️ <b>Bot</b>', { parse_mode: 'HTML', ...inline.botHub });
}

async function showTimezone(ctx) {
  const tz = await timezoneService.getTimezone();
  await renderScreen(ctx, `🌍 <b>Timezone</b>\n\nCurrent: <code>${tz}</code>`, {
    parse_mode: 'HTML',
    ...inline.timezoneScreen,
  });
}

async function promptSetTimezone(ctx) {
  await pendingInput.set('bot:timezone:set');
  await ctx.reply('Send an IANA timezone name, e.g. "Africa/Nairobi" or "America/New_York".', bbtb.cancelOnly);
  await ctx.answerCbQuery();
}

async function showStatus(ctx) {
  const coins = await coinsDb.getAll();
  const channels = await channelsDb.getAll();
  const mode = await modes.getCurrentMode();
  const uptimeSec = Math.floor(process.uptime());
  const mem = process.memoryUsage();

  let dbOk = true;
  try {
    await pool.query('SELECT 1');
  } catch {
    dbOk = false;
  }
  const redisOk = redis.status === 'ready';

  const text =
    `📊 <b>Status &amp; Health</b>\n\n` +
    `Uptime: ${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m\n` +
    `Mode: ${mode.label}\n` +
    `Tracked coins: ${coins.length}\n` +
    `Channels: ${channels.length}\n` +
    `Database: ${dbOk ? '✅ connected' : '⚠️ error'}\n` +
    `Redis: ${redisOk ? '✅ connected' : '⚠️ ' + redis.status}\n` +
    `Memory: ${Math.round(mem.rss / 1024 / 1024)}MB / ${config.memoryLimitMb}MB`;

  await renderScreen(ctx, text, { parse_mode: 'HTML', ...inline.statusScreen });
}

module.exports = { showHub, showTimezone, promptSetTimezone, showStatus };
