const { Markup } = require('telegraf');
const { bySymbol } = require('../coins');
const coinSettingsDb = require('../db/coinSettings');
const marketData = require('../services/marketData');
const cardRenderer = require('../services/cardRenderer');
const templateEngine = require('../lib/templateEngine');
const format = require('../lib/format');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');
const logger = require('../lib/logger');

// channelId: which channel's settings we're editing (for now, in a DM
// context this would be the user's own "personal" pseudo-channel row —
// wiring that mapping is part of the channel-management screen, not this
// file's concern).
async function showCoinPanel(ctx, symbol, channelId) {
  navStack.push(ctx, 'coinPanel', { symbol, channelId });
  const coin = bySymbol.get(symbol);
  if (!coin) return safeEdit(ctx, '❌ Unknown coin.', navRow());

  const [prices, settingsMap] = await Promise.all([
    marketData.fetchAllPrices(),
    coinSettingsDb.getAllForChannel(channelId),
  ]);
  const priceInfo = prices[symbol];
  const settings = settingsMap.get(symbol);
  const staleTag = priceInfo && marketData.isStale(priceInfo.fetchedAt) ? ' ⚠️ delayed' : '';
  const priceLine = priceInfo ? `$${format.formatPrice(priceInfo.price)}${staleTag}` : 'unavailable';

  const text =
    `*${coin.name} (${coin.symbol})*\n` +
    `Price: ${priceLine}\n\n` +
    `🔔 Mute: ${settings.muted ? 'Muted 🔕' : 'Active 🔔'}\n` +
    `📏 Threshold: ${coin.isStable ? 'n/a (stablecoin)' : `${settings.thresholdValue}${settings.thresholdType === 'pct' ? '%' : ' USD'}`}\n` +
    `🎯 Milestone step: ${settings.milestoneDisabled ? 'disabled' : (settings.milestoneStep ? `$${settings.milestoneStep}` : 'n/a')}\n` +
    `⏱ Cooldown: ${settings.cooldownMinutes ? `${settings.cooldownMinutes}m (custom)` : 'default'}\n` +
    `⭐ Watchlist: ${settings.onWatchlist ? 'yes' : 'no'}`;

  const rows = [
    [callback(settings.muted ? '🔔 Unmute' : '🔕 Mute', `coinpanel:mute:${symbol}:${channelId}`)],
    [callback('📏 Edit Threshold', `coinpanel:threshold:${symbol}:${channelId}`)],
    [callback('🎯 Edit Milestone Step', `coinpanel:milestone:${symbol}:${channelId}`)],
    [callback('⏱ Edit Cooldown', `coinpanel:cooldown:${symbol}:${channelId}`)],
    [callback(settings.onWatchlist ? '⭐ Remove from Watchlist' : '☆ Add to Watchlist', `coinpanel:watchlist:${symbol}:${channelId}`)],
    [callback('📈 View Chart', `chart:open:${symbol}`)],
    [callback('📇 Get Price Card', `coinpanel:card:${symbol}:${channelId}`)],
    [callback('📢 Post This to a Channel', `manualpost:coinselected:${symbol}`)],
    navRow(),
  ];

  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function toggleMute(ctx, symbol, channelId) {
  const settingsMap = await coinSettingsDb.getAllForChannel(channelId);
  const current = settingsMap.get(symbol);
  await coinSettingsDb.upsert(channelId, symbol, { muted: !current.muted });
  await showCoinPanel(ctx, symbol, channelId);
}

async function toggleWatchlist(ctx, symbol, channelId) {
  const settingsMap = await coinSettingsDb.getAllForChannel(channelId);
  const current = settingsMap.get(symbol);
  await coinSettingsDb.upsert(channelId, symbol, { onWatchlist: !current.onWatchlist });
  await showCoinPanel(ctx, symbol, channelId);
}

// Renders the current card and sends it straight to the user's own DM —
// no channel required. This is the fastest way to actually see what a
// card looks like: preview it here first, then decide whether/where to
// post it for real via "Post This to a Channel".
async function sendPreviewCard(ctx, symbol, channelId) {
  const coin = bySymbol.get(symbol);
  try {
    await ctx.answerCbQuery('Rendering…').catch(() => {});
    const usersDb = require('../db/users');
    const { pool } = require('../db/postgres');
    const { rows } = await pool.query('SELECT card_style FROM users WHERE telegram_id = $1', [ctx.from.id]);
    const cardStyle = (rows[0] && rows[0].card_style) || 'compact';

    const prices = await marketData.fetchAllPrices();
    const priceInfo = prices[symbol];
    if (!priceInfo) {
      await ctx.reply(`⚠️ No live price available for ${symbol} right now.`);
      return;
    }
    const buffer = await cardRenderer.renderCard({
      coin, price: priceInfo.price, direction: null, alertType: 'manual', mode: cardStyle,
    });
    await ctx.replyWithPhoto({ source: buffer }, {
      caption: `${await templateEngine.renderCaption('manual', { coin, price: priceInfo.price })}\n<i>(preview, ${cardStyle})</i>`,
      parse_mode: 'HTML',
    });
  } catch (err) {
    logger.error('Card preview failed', { symbol, message: err.message });
    await ctx.reply('⚠️ Could not render a preview right now — try again shortly.');
  }
}

// Threshold/milestone/cooldown numeric edits are collected via a "type a
// value" prompt (see bot.js's text-input router, which checks
// ctx.session.awaitingInput and calls back into these setters).
async function promptForInput(ctx, field, symbol, channelId) {
  ctx.session.awaitingInput = { field, symbol, channelId };
  const prompts = {
    threshold: 'Send the new threshold value (e.g. 3 for 3%, or "50usd" for a fixed $ move), or ❌ Cancel.',
    milestone: 'Send the new milestone step in USD (e.g. 500), or "off" to disable milestones for this coin, or ❌ Cancel.',
    cooldown: 'Send the new cooldown in minutes (e.g. 15), or "default" to clear the override, or ❌ Cancel.',
  };
  const replyKb = require('../keyboards/replyKeyboards');
  await ctx.reply(prompts[field], replyKb.cancelOnly);
}

async function applyInput(ctx, text) {
  const pending = ctx.session.awaitingInput;
  if (!pending) return false;
  delete ctx.session.awaitingInput;
  const { field, symbol, channelId } = pending;

  if (text.trim() === '❌ Cancel') {
    await ctx.reply('Cancelled.');
    await showCoinPanel(ctx, symbol, channelId);
    return true;
  }

  const val = text.trim().toLowerCase();
  if (field === 'threshold') {
    const isUsd = val.endsWith('usd');
    const num = parseFloat(val.replace('usd', ''));
    if (Number.isNaN(num) || num <= 0) {
      await ctx.reply(format.errorMessage('Invalid value', 'Send a positive number.'), { parse_mode: 'Markdown' });
      return true;
    }
    await coinSettingsDb.upsert(channelId, symbol, { thresholdType: isUsd ? 'usd' : 'pct', thresholdValue: num });
  } else if (field === 'milestone') {
    if (val === 'off') {
      await coinSettingsDb.upsert(channelId, symbol, { milestoneDisabled: true });
    } else {
      const num = parseFloat(val);
      if (Number.isNaN(num) || num <= 0) {
        await ctx.reply(format.errorMessage('Invalid value', 'Send a positive number, or "off".'), { parse_mode: 'Markdown' });
        return true;
      }
      await coinSettingsDb.upsert(channelId, symbol, { milestoneStep: num, milestoneDisabled: false });
    }
  } else if (field === 'cooldown') {
    if (val === 'default') {
      await coinSettingsDb.upsert(channelId, symbol, { cooldownMinutes: null });
    } else {
      const num = parseInt(val, 10);
      if (Number.isNaN(num) || num <= 0) {
        await ctx.reply(format.errorMessage('Invalid value', 'Send a positive whole number of minutes, or "default".'), { parse_mode: 'Markdown' });
        return true;
      }
      await coinSettingsDb.upsert(channelId, symbol, { cooldownMinutes: num });
    }
  }

  const replyKb = require('../keyboards/replyKeyboards');
  await ctx.reply(format.successMessage('Updated.'), replyKb.home);
  await showCoinPanel(ctx, symbol, channelId);
  return true;
}

module.exports = { showCoinPanel, toggleMute, toggleWatchlist, sendPreviewCard, promptForInput, applyInput };
