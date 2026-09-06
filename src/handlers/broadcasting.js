const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const channelsDb = require('../db/channels');
const templatesDb = require('../db/templates');
const templateEngine = require('../services/templateEngine');
const pendingInput = require('../services/pendingInput');

async function showHub(ctx) {
  await ctx.editMessageText('📤 <b>Broadcasting</b>\n\nWhere posts go, and what they look like.', {
    parse_mode: 'HTML',
    ...inline.broadcastingHub,
  });
}

async function showChannelList(ctx) {
  const channels = await channelsDb.getAll();
  await ctx.editMessageText('📺 <b>Channels</b>\n\n⭐ = primary (from CHANNEL_ID, always on)', {
    parse_mode: 'HTML',
    ...inline.channelList(channels),
  });
}

async function showChannelDetail(ctx, name) {
  const channel = await channelsDb.get(name);
  if (!channel) return ctx.answerCbQuery('Channel not found.');
  const toggles = await channelsDb.getPostTypeToggles(name);
  await ctx.editMessageText(
    `<b>${channel.is_default ? '⭐ ' : ''}${channel.name}</b>\n<code>${channel.chat_id}</code>\n\nTap a post type to toggle it for this channel.`,
    { parse_mode: 'HTML', ...inline.channelDetail(channel, toggles) }
  );
}

async function toggleChannelPostType(ctx, name, postType) {
  const toggles = await channelsDb.getPostTypeToggles(name);
  await channelsDb.setPostTypeEnabled(name, postType, !toggles[postType]);
  await showChannelDetail(ctx, name);
  await ctx.answerCbQuery();
}

async function promptAddChannel(ctx) {
  await pendingInput.set('channel:add');
  await ctx.reply(
    'Send the channel to add — its @handle or numeric chat ID. The bot must already be an admin there; I\'ll test-post to confirm before saving.',
    bbtb.cancelOnly
  );
  await ctx.answerCbQuery();
}

async function confirmRemoveChannel(ctx, name) {
  const channel = await channelsDb.get(name);
  if (!channel) return ctx.answerCbQuery('Channel not found.');
  if (channel.is_default) return ctx.answerCbQuery('The primary channel can\u2019t be removed.');
  await ctx.editMessageText(`Remove channel <b>${name}</b>? It will stop receiving any posts.`, {
    parse_mode: 'HTML',
    ...inline.channelRemoveConfirm(name),
  });
}

async function removeChannel(ctx, name) {
  try {
    await channelsDb.removeChannel(name);
    await ctx.answerCbQuery('Removed.');
    await showChannelList(ctx);
  } catch (err) {
    await ctx.answerCbQuery(err.message);
  }
}

async function showFormatMenu(ctx) {
  await ctx.editMessageText('✍️ <b>Post Format</b>\n\nPick an alert type to view or edit its caption template.', {
    parse_mode: 'HTML',
    ...inline.postFormatMenu,
  });
}

async function showFormatDetail(ctx, alertType) {
  const custom = await templatesDb.get(alertType);
  const current = custom || templateEngine.DEFAULT_TEMPLATES[alertType] || '(no default)';
  await ctx.editMessageText(`<b>${alertType}</b> caption template:\n\n<code>${current}</code>`, {
    parse_mode: 'HTML',
    ...inline.postFormatDetail(alertType),
  });
}

async function promptEditFormat(ctx, alertType) {
  await pendingInput.set(`format:setnew:${alertType}`);
  await ctx.reply(
    `Send the new caption template for "${alertType}". Use {variables} like {name}, {price}, {channel_handle}. A line with a null variable is dropped automatically.`,
    bbtb.cancelOnly
  );
  await ctx.answerCbQuery();
}

async function resetFormat(ctx, alertType) {
  await templatesDb.reset(alertType);
  await showFormatDetail(ctx, alertType);
  await ctx.answerCbQuery('Reset to default.');
}

async function previewFormat(ctx, alertType) {
  const rendered = await templateEngine.renderCaption(alertType, {
    coin: { symbol: 'BTC', name: 'Bitcoin' },
    price: 84994.5,
    changePct: 2.14,
    changeUsd: 1780.22,
    direction: 'up',
    channel: { name: 'main' },
  });
  await ctx.answerCbQuery();
  await ctx.reply(`Preview:\n\n${rendered}`, { parse_mode: 'HTML' });
}

module.exports = {
  showHub,
  showChannelList,
  showChannelDetail,
  toggleChannelPostType,
  promptAddChannel,
  confirmRemoveChannel,
  removeChannel,
  showFormatMenu,
  showFormatDetail,
  promptEditFormat,
  resetFormat,
  previewFormat,
};
