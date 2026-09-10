const { Markup } = require('telegraf');
const tz = require('../lib/timezone');
const usersDb = require('../db/users');
const { pool } = require('../db/postgres');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit, sendEphemeral } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');

async function showTimezone(ctx) {
  navStack.push(ctx, 'timezone', {});
  const { rows: userRows } = await pool.query('SELECT timezone, time_format FROM users WHERE telegram_id = $1', [ctx.from.id]);
  const user = userRows[0] || { timezone: 'UTC', time_format: '24h' };
  const hour12 = user.time_format === '12h';
  const now = tz.formatInZone(new Date(), user.timezone, { hour12 });

  const text =
    `🌍 *Timezone*\n\nCurrent: *${user.timezone}*\nRight now there: ${now}\nClock format: ${hour12 ? '12-hour' : '24-hour'}\n\n` +
    `Used for quiet hours and digest timing — pick a zone, or type an IANA name (e.g. Africa/Nairobi) if yours isn't listed.`;

  const buttonRows = [];
  for (let i = 0; i < tz.COMMON_ZONES.length; i += 2) {
    buttonRows.push(
      tz.COMMON_ZONES.slice(i, i + 2).map((z) => callback(`${z.id === user.timezone ? '✅ ' : ''}${z.label}`, `tz:set:${z.id}`))
    );
  }
  buttonRows.push([callback('⌨️ Type a Zone Name', 'tz:custom')]);
  buttonRows.push([callback(hour12 ? '🕛 Switch to 24-hour' : '🕐 Switch to 12-hour', 'tz:toggleformat')]);
  buttonRows.push(navRow());

  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttonRows) });
}

async function setTimezone(ctx, zoneId) {
  await usersDb.setTimezone(ctx.from.id, zoneId);
  await sendEphemeral(ctx, `✅ Timezone set to ${zoneId}`);
  await showTimezone(ctx);
}

async function toggleFormat(ctx) {
  const { rows } = await pool.query('SELECT time_format FROM users WHERE telegram_id = $1', [ctx.from.id]);
  const next = (rows[0] && rows[0].time_format) === '12h' ? '24h' : '12h';
  await usersDb.setTimeFormat(ctx.from.id, next);
  await showTimezone(ctx);
}

async function promptCustom(ctx) {
  ctx.session.awaitingCustomTimezone = true;
  const replyKb = require('../keyboards/replyKeyboards');
  await ctx.reply('⌨️ Send an IANA timezone name (e.g. Asia/Kolkata, Africa/Nairobi), or ❌ Cancel.', replyKb.cancelOnly);
}

async function handleCustomInput(ctx, text) {
  if (!ctx.session.awaitingCustomTimezone) return false;
  delete ctx.session.awaitingCustomTimezone;
  const trimmed = text.trim();

  if (trimmed === '❌ Cancel') {
    await ctx.reply('Cancelled.');
    await showTimezone(ctx);
    return true;
  }
  if (!tz.isValidTimeZone(trimmed)) {
    await ctx.reply('❌ Not a recognized timezone. Use Continent/City format, e.g. "Europe/Paris".');
    return true;
  }
  await setTimezone(ctx, trimmed);
  return true;
}

module.exports = { showTimezone, setTimezone, toggleFormat, promptCustom, handleCustomInput };
