// Manual posting: lets an admin push a card straight to a channel right
// now, bypassing the threshold/milestone trigger logic entirely. Exists
// for two reasons: (1) there was previously no way to verify the bot could
// post at all without waiting for a real market move, and (2) it's
// generally useful on its own — "post current BTC price to the channel"
// is a reasonable thing to want on demand.
const { Markup } = require('telegraf');
const { bySymbol } = require('../coins');
const channelsDb = require('../db/channels');
const marketData = require('../services/marketData');
const cardRenderer = require('../services/cardRenderer');
const format = require('../lib/format');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit, sendEphemeral } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');
const logger = require('../lib/logger');

// Step 1: pick which channel to post to (only shows channels this bot is
// currently active/admin in).
async function showChannelPicker(ctx) {
  navStack.push(ctx, 'postChannelPicker', {});
  const channels = await channelsDb.getActiveChannels();
  if (!channels.length) {
    await safeEdit(
      ctx,
      '📢 *Post to Channel*\n\nNo channels yet. Add this bot as an admin to a channel first — it registers automatically once promoted.',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([navRow()]) }
    );
    return;
  }
  const rows = channels.map((c) => [callback(c.title || String(c.chat_id), `manualpost:pickchannel:${c.id}`)]);
  rows.push(navRow());
  await safeEdit(ctx, '📢 *Post to Channel*\n\nWhich channel?', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

// Step 2: pick a coin (paginated, same list as everywhere else)
async function showCoinPicker(ctx, channelId, page = 0) {
  navStack.push(ctx, 'postCoinPicker', { channelId, page });
  const { coins } = require('../coins');
  const { paginate } = require('../keyboards/pagination');
  const { pageItems, controlRow } = paginate(coins, page, 8, `manualpost:coinpage:${channelId}`);
  const rows = pageItems.map((c) => [callback(`${c.symbol} — ${c.name}`, `manualpost:pickcoin:${channelId}:${c.symbol}`)]);
  rows.push(...controlRow);
  rows.push(navRow());
  await safeEdit(ctx, '📢 *Post to Channel*\n\nWhich coin?', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

// Step 3: confirm before actually posting (per the "confirmation preview
// before firing" rule established for bulk actions — applies here too
// since this posts publicly and immediately).
async function showConfirm(ctx, channelId, symbol) {
  navStack.push(ctx, 'postConfirm', { channelId, symbol });
  const channel = await channelsDb.getById(channelId);
  const coin = bySymbol.get(symbol);
  const prices = await marketData.fetchAllPrices();
  const priceInfo = prices[symbol];
  if (!priceInfo) {
    await safeEdit(ctx, `⚠️ No live price available for ${symbol} right now. Try again shortly.`, Markup.inlineKeyboard([navRow()]));
    return;
  }
  const staleTag = marketData.isStale(priceInfo.fetchedAt) ? ' ⚠️ (delayed data)' : '';
  const text =
    `📢 *Confirm post*\n\n` +
    `Channel: ${channel ? (channel.title || channel.chat_id) : 'unknown'}\n` +
    `Coin: ${coin.name} (${coin.symbol})\n` +
    `Price: $${format.formatPrice(priceInfo.price)}${staleTag}\n\n` +
    `This posts immediately and publicly. Continue?`;
  const rows = [
    [callback('✅ Post Now', `manualpost:confirm:${channelId}:${symbol}`)],
    navRow(),
  ];
  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function doPost(ctx, channelId, symbol) {
  const channel = await channelsDb.getById(channelId);
  const coin = bySymbol.get(symbol);
  if (!channel || !coin) {
    await sendEphemeral(ctx, '⚠️ Channel or coin no longer available.');
    return;
  }
  try {
    const prices = await marketData.fetchAllPrices();
    const priceInfo = prices[symbol];
    if (!priceInfo) {
      await sendEphemeral(ctx, '⚠️ No live price available right now — nothing posted.');
      return;
    }
    const buffer = await cardRenderer.renderCard({
      coin,
      price: priceInfo.price,
      direction: null, // no badge for a manual post — there's no threshold/milestone context to show
      alertType: 'manual',
      mode: channel.card_style || 'compact',
    });
    await ctx.telegram.sendPhoto(channel.chat_id, { source: buffer }, { caption: `${coin.name} — $${format.formatPrice(priceInfo.price)}` });
    await sendEphemeral(ctx, format.successMessage(`Posted ${coin.symbol} to ${channel.title || channel.chat_id}.`));
  } catch (err) {
    logger.error('Manual post failed', { channelId, symbol, message: err.message });
    await ctx.reply(format.errorMessage('Could not post', 'The bot may have lost admin rights in that channel, or Telegram rejected the image.'), { parse_mode: 'Markdown' });
  }
}

// Alt entry point: coin already chosen (from the coin panel's "Post This to
// a Channel" shortcut) — skip straight to picking which channel, then go
// directly to confirm.
async function showChannelPickerForCoin(ctx, symbol) {
  navStack.push(ctx, 'postChannelPickerForCoin', { symbol });
  const channels = await channelsDb.getActiveChannels();
  const coin = bySymbol.get(symbol);
  if (!channels.length) {
    await safeEdit(
      ctx,
      `📢 *Post ${coin.symbol}*\n\nNo channels yet. Add this bot as an admin to a channel first — it registers automatically once promoted.`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([navRow()]) }
    );
    return;
  }
  const rows = channels.map((c) => [callback(c.title || String(c.chat_id), `manualpost:pickcoin:${c.id}:${symbol}`)]);
  rows.push(navRow());
  await safeEdit(ctx, `📢 *Post ${coin.symbol}*\n\nWhich channel?`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

module.exports = { showChannelPicker, showChannelPickerForCoin, showCoinPicker, showConfirm, doPost };
