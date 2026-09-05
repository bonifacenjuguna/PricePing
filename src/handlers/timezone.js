const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const format = require('../lib/format');
const ephemeral = require('../lib/ephemeral');
const bbtb = require('../keyboards/bbtb');
const tz = require('../lib/timezone');

/**
 * 🌍 Timezone — exists to serve 📅 Scheduled Commits: a scheduled time only
 * means something if it's in a time the person actually thinks in, not raw
 * UTC. Picking a zone here is what lets "tomorrow 9am" in Scheduled
 * Commits mean their 9am, not GitHub servers' 9am.
 */
async function showTimezone(ctx) {
  const users = require('../lib/users');
  const user = await users.getUser(ctx.from.id);
  const current = user.timezone || 'UTC';
  const now = tz.formatInZone(new Date(), current);

  const text =
    `🌍 *Timezone*\n\n` +
    `Current: *${format.escapeMd(current)}*\n` +
    `Right now there: ${format.escapeMd(now)}\n\n` +
    `Used by 📅 Scheduled Commits to understand what you mean by a time — pick the zone below, or send an IANA zone name as text \\(e\\.g\\. Asia/Kolkata\\) if yours isn\u2019t listed\\.`;

  const rows = [];
  for (let i = 0; i < tz.COMMON_ZONES.length; i += 2) {
    const pair = tz.COMMON_ZONES.slice(i, i + 2).map((z) =>
      style.callback(`${z.id === current ? '✅ ' : ''}${z.label}`, `timezone:set:${z.id}`, style.BLUE)
    );
    rows.push(pair);
  }
  rows.push([style.callback('⌨️ Type a Zone Name', 'timezone:custom', style.BLUE)]);

  await ephemeral.sendEphemeral(ctx, '🌍 Timezone', bbtb.automationScheduleSub);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function setTimezone(ctx, zoneId) {
  const { pool } = require('../db/postgres');
const ephemeral = require('../lib/ephemeral');
  await pool.query('UPDATE users SET timezone = $1 WHERE telegram_id = $2', [zoneId, ctx.from.id]);
  await ephemeral.sendEphemeral(ctx, format.successMessage(`Timezone set to ${zoneId}`));
  return showTimezone(ctx);
}

async function promptCustomTimezone(ctx) {
  ctx.session.awaitingCustomTimezone = true;
  await ctx.reply(
    '⌨️ Send an IANA timezone name (e.g. Asia/Kolkata, America/Sao_Paulo — the same names used everywhere in tech), or ❌ Cancel.',
    bbtb.cancelOnly
  );
}

async function handleCustomTimezoneInput(ctx) {
  delete ctx.session.awaitingCustomTimezone;
  const text = ctx.message.text.trim();

  if (text === '❌ Cancel') {
    await ctx.reply('Cancelled.');
    return showTimezone(ctx);
  }
  if (!tz.isValidTimeZone(text)) {
    await ctx.reply(format.errorMessage(
      'Not a recognized timezone',
      `"${text}" isn\u2019t a valid IANA zone name`,
      'Use the Continent/City format, e.g. "Europe/Paris" or "Asia/Singapore".'
    ));
    return;
  }
  return setTimezone(ctx, text);
}

module.exports = { showTimezone, setTimezone, promptCustomTimezone, handleCustomTimezoneInput };
