const { Markup } = require('telegraf');
const usersDb = require('../db/users');
const sourceHealthDb = require('../db/sourceHealth');
const { pool } = require('../db/postgres');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');

async function showSettings(ctx) {
  navStack.push(ctx, 'settings', {});
  const { rows } = await pool.query('SELECT card_style, timezone FROM users WHERE telegram_id = $1', [ctx.from.id]);
  const user = rows[0] || { card_style: 'compact', timezone: 'UTC' };

  const text =
    `⚙️ *Settings*\n\n` +
    `Card style: *${user.card_style}*\n` +
    `Timezone: *${user.timezone}*`;

  const buttonRows = [
    [callback(user.card_style === 'compact' ? '🖼 Switch to Loose Cards' : '🖼 Switch to Compact Cards', 'settings:togglecardstyle')],
    [callback('🌍 Timezone', 'tz:show')],
    [callback('📢 Post to Channel', 'manualpost:start')],
    [callback('📡 Alert Delivery', 'chsettings:show:0')],
    [callback('📶 Status', 'settings:status')],
    [callback('⭐ My Watchlist', 'settings:watchlist')],
    navRow(),
  ];

  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttonRows) });
}

async function toggleCardStyle(ctx) {
  const { rows } = await pool.query('SELECT card_style FROM users WHERE telegram_id = $1', [ctx.from.id]);
  const next = (rows[0] && rows[0].card_style) === 'compact' ? 'loose' : 'compact';
  await usersDb.setCardStyle(ctx.from.id, next);
  await showSettings(ctx);
}

async function showStatus(ctx) {
  navStack.push(ctx, 'status', {});
  const health = await sourceHealthDb.getAll();
  const bySource = new Map(health.map((h) => [h.source, h]));
  const sources = ['binance', 'kraken', 'coingecko', 'coinpaprika', 'coinlore', 'geckoterminal', 'feargreed'];

  const lines = sources.map((s) => {
    const h = bySource.get(s);
    if (!h) return `⚪ ${s} — no data yet`;
    const failing = h.consecutive_failures > 0;
    const icon = failing ? '🔴' : '🟢';
    const lastOk = h.last_success_at ? new Date(h.last_success_at).toISOString().slice(11, 19) + ' UTC' : 'never';
    return `${icon} ${s} — last OK ${lastOk}${failing ? ` (${h.consecutive_failures} failures)` : ''}`;
  });

  const text = `📡 *Data Source Status*\n\n${lines.join('\n')}`;
  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([navRow()]) });
}

module.exports = { showSettings, toggleCardStyle, showStatus };
