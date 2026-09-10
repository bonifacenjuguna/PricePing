const { Markup } = require('telegraf');
const { coins } = require('../coins');
const coinSettingsDb = require('../db/coinSettings');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { paginate } = require('../keyboards/pagination');
const { safeEdit } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');

const PAGE_SIZE = 8;

// Callback-data scheme used throughout this file (kept consistent so
// pagination/toggle/selectall never lose track of mode, filter or which
// channel is being configured):
//   coinlist:<mode>:<filter>:<channelId>:page:<N>   -- pagination
//   coinlist:switchmode:<newMode>:<page>:<filter>:<channelId>
//   coinlist:toggle:<symbol>:<page>:<filter>:<channelId>
//   coinlist:selectall:<page>:<filter>:<channelId>
//   coinlist:selectnone:<page>:<filter>:<channelId>
// filter: 'all' | 'watchlist'

function encodeArgs({ mode, filter, channelId }) {
  return `${mode}:${filter || 'all'}:${channelId ?? 0}`;
}

// mode: 'view' (tap a coin -> opens its panel) | 'select' (tap toggles
// checkbox for bulk actions). Selected symbols live in ctx.session.bulkSelected.
async function showCoinList(ctx, { page = 0, mode = 'view', filter = null, channelId = 0 } = {}) {
  navStack.push(ctx, 'coinList', { page, mode, filter, channelId });
  if (!ctx.session.bulkSelected) ctx.session.bulkSelected = [];
  const selected = new Set(ctx.session.bulkSelected);

  let list = coins;
  if (filter === 'watchlist') {
    const settingsMap = await coinSettingsDb.getAllForChannel(channelId);
    list = coins.filter((c) => settingsMap.get(c.symbol).onWatchlist);
    if (!list.length) {
      await safeEdit(ctx, '⭐ *Your watchlist is empty.*\n\nOpen any coin\'s panel and tap "Add to Watchlist" to star it.', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([navRow()]) });
      return;
    }
  }

  const prefix = `coinlist:${encodeArgs({ mode, filter, channelId })}`;
  const { pageItems, controlRow } = paginate(list, page, PAGE_SIZE, prefix);
  const argsTail = `${page}:${filter || 'all'}:${channelId ?? 0}`;

  const rows = pageItems.map((coin) => {
    if (mode === 'select') {
      const mark = selected.has(coin.symbol) ? '✅' : '⬜';
      return [callback(`${mark} ${coin.symbol}`, `coinlist:toggle:${coin.symbol}:${argsTail}`)];
    }
    return [callback(`${coin.symbol} — ${coin.name}`, `coinpanel:open:${coin.symbol}:${channelId ?? 0}`)];
  });

  rows.push(...controlRow);

  if (mode === 'select') {
    rows.push([
      callback('Select All', `coinlist:selectall:${argsTail}`),
      callback('Select None', `coinlist:selectnone:${argsTail}`),
    ]);
    if (selected.size > 0) {
      rows.push([callback(`⚡ Bulk Actions (${selected.size} selected)`, 'bulk:menu')]);
    }
    rows.push([callback('↩️ Exit Select Mode', `coinlist:switchmode:view:${argsTail}`)]);
  } else {
    rows.push([callback('☑️ Select Multiple', `coinlist:switchmode:select:${argsTail}`)]);
  }

  rows.push(navRow());

  const title = filter === 'watchlist' ? '⭐ *Your Watchlist*' : '📊 *Assets*';
  const text = mode === 'select'
    ? `☑️ *Select coins* (${selected.size} selected)\n\nTap coins to select, then choose a bulk action.`
    : `${title} — tap a coin to view/edit its settings.`;

  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function toggleSelection(ctx, symbol, { page, filter, channelId }) {
  if (!ctx.session.bulkSelected) ctx.session.bulkSelected = [];
  const idx = ctx.session.bulkSelected.indexOf(symbol);
  if (idx === -1) ctx.session.bulkSelected.push(symbol);
  else ctx.session.bulkSelected.splice(idx, 1);
  await showCoinList(ctx, { page, mode: 'select', filter, channelId });
}

async function selectAll(ctx, { page, filter, channelId }) {
  let symbols = coins.map((c) => c.symbol);
  if (filter === 'watchlist') {
    const settingsMap = await coinSettingsDb.getAllForChannel(channelId);
    symbols = coins.filter((c) => settingsMap.get(c.symbol).onWatchlist).map((c) => c.symbol);
  }
  ctx.session.bulkSelected = symbols;
  await showCoinList(ctx, { page, mode: 'select', filter, channelId });
}

async function selectNone(ctx, { page, filter, channelId }) {
  ctx.session.bulkSelected = [];
  await showCoinList(ctx, { page, mode: 'select', filter, channelId });
}

module.exports = { showCoinList, toggleSelection, selectAll, selectNone, PAGE_SIZE };
