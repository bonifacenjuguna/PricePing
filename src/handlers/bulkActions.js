const { Markup } = require('telegraf');
const coinSettingsDb = require('../db/coinSettings');
const format = require('../lib/format');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit, sendEphemeral } = require('../lib/ephemeral');

async function showBulkMenu(ctx) {
  const selected = ctx.session.bulkSelected || [];
  if (!selected.length) {
    await sendEphemeral(ctx, '⚠️ No coins selected.');
    return;
  }
  const text = `⚡ *Bulk Actions*\n\nApplying to ${selected.length} coins:\n${selected.join(', ')}`;
  const rows = [
    [callback('🔕 Mute All', 'bulk:action:mute'), callback('🔔 Unmute All', 'bulk:action:unmute')],
    [callback('☆ Add to Watchlist', 'bulk:action:watchlist_add'), callback('⭐ Remove from Watchlist', 'bulk:action:watchlist_remove')],
    [callback('📏 Set Threshold', 'bulk:action:threshold')],
    [callback('🎯 Set Milestone Step', 'bulk:action:milestone')],
    navRow(),
  ];
  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

// Simple bulk actions (no extra input needed) apply immediately with a
// confirmation preview shown beforehand via showBulkMenu already listing
// the selected coins — for actions needing a value (threshold/milestone),
// route through the same text-input flow as the single-coin panel.
async function applySimpleAction(ctx, action, channelId) {
  const selected = ctx.session.bulkSelected || [];
  if (!selected.length) return sendEphemeral(ctx, '⚠️ No coins selected.');

  const fieldMap = {
    mute: { muted: true },
    unmute: { muted: false },
    watchlist_add: { onWatchlist: true },
    watchlist_remove: { onWatchlist: false },
  };
  const fields = fieldMap[action];
  if (!fields) return;

  await coinSettingsDb.bulkUpsert(channelId, selected, fields);
  await sendEphemeral(ctx, format.successMessage(`Applied to ${selected.length} coins.`));
  ctx.session.bulkSelected = [];
}

async function promptBulkValueInput(ctx, field, channelId) {
  const selected = ctx.session.bulkSelected || [];
  if (!selected.length) return sendEphemeral(ctx, '⚠️ No coins selected.');
  ctx.session.awaitingBulkInput = { field, channelId, symbols: selected };
  const prompts = {
    threshold: `Send the threshold value to apply to all ${selected.length} selected coins (e.g. 3 for 3%), or ❌ Cancel.`,
    milestone: `Send the milestone step ($) to apply to all ${selected.length} selected coins, or ❌ Cancel.`,
  };
  const replyKb = require('../keyboards/replyKeyboards');
  await ctx.reply(prompts[field], replyKb.cancelOnly);
}

async function applyBulkInput(ctx, text) {
  const pending = ctx.session.awaitingBulkInput;
  if (!pending) return false;
  delete ctx.session.awaitingBulkInput;
  const { field, channelId, symbols } = pending;

  if (text.trim() === '❌ Cancel') {
    await ctx.reply('Cancelled.');
    return true;
  }

  const num = parseFloat(text.trim());
  if (Number.isNaN(num) || num <= 0) {
    await ctx.reply(format.errorMessage('Invalid value', 'Send a positive number.'), { parse_mode: 'Markdown' });
    return true;
  }

  const fields = field === 'threshold' ? { thresholdType: 'pct', thresholdValue: num } : { milestoneStep: num, milestoneDisabled: false };
  await coinSettingsDb.bulkUpsert(channelId, symbols, fields);
  const replyKb = require('../keyboards/replyKeyboards');
  await ctx.reply(format.successMessage(`Applied to ${symbols.length} coins.`), replyKb.home);
  ctx.session.bulkSelected = [];
  return true;
}

module.exports = { showBulkMenu, applySimpleAction, promptBulkValueInput, applyBulkInput };
