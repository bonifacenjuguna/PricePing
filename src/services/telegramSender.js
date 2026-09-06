const config = require('../config');
const logger = require('../utils/logger');
const channelsDb = require('../db/channels');
const templateEngine = require('./templateEngine');

let botInstance = null;
function init(bot) {
  botInstance = bot;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Normalizes a DB channel row (chat_id, name) into the shape
// templateEngine.channelHandle() expects (chatId, name).
function normalizeChannel(row) {
  return { chatId: row.chat_id, name: row.name };
}

// Sends one alert/post to every channel that has `alertType` enabled.
// ctx: same shape templateEngine.buildVariables() expects, plus `photo`
// (a PNG Buffer from cardRenderer/chartRenderer).
async function broadcast(alertType, ctx, photoBuffer) {
  const channels = await channelsDb.getChannelsForPostType(alertType);
  const results = [];

  for (const channelRow of channels) {
    const channel = normalizeChannel(channelRow);
    const caption = await templateEngine.renderCaption(alertType, { ...ctx, channel });
    try {
      await botInstance.telegram.sendPhoto(
        channel.chatId,
        { source: photoBuffer },
        { caption, parse_mode: 'HTML' }
      );
      results.push({ channel: channel.name, ok: true });
    } catch (err) {
      logger.warn(`Failed to send ${alertType} post to channel ${channel.name}`, { message: err.message });
      results.push({ channel: channel.name, ok: false, error: err.message });
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(config.sendDelayMs);
  }

  return results;
}

// Plain-text send (no image) to every channel with `alertType` enabled —
// used for things like a text-only digest fallback if ever needed.
async function broadcastText(alertType, text, opts = {}) {
  const channels = await channelsDb.getChannelsForPostType(alertType);
  const results = [];
  for (const channelRow of channels) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await botInstance.telegram.sendMessage(channelRow.chat_id, text, { parse_mode: 'HTML', ...opts });
      results.push({ channel: channelRow.name, ok: true });
    } catch (err) {
      logger.warn(`Failed to send text post to channel ${channelRow.name}`, { message: err.message });
      results.push({ channel: channelRow.name, ok: false, error: err.message });
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(config.sendDelayMs);
  }
  return results;
}

// System messages (startup heartbeat, etc.) — every bound channel,
// regardless of per-post-type toggles, since this isn't a content post type
// an owner would want to opt a channel out of.
async function broadcastToAllChannels(text, opts = {}) {
  const channels = await channelsDb.getAll();
  const results = [];
  for (const channelRow of channels) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await botInstance.telegram.sendMessage(channelRow.chat_id, text, { parse_mode: 'HTML', ...opts });
      results.push({ channel: channelRow.name, ok: true });
    } catch (err) {
      logger.warn(`Failed to send system message to channel ${channelRow.name}`, { message: err.message });
      results.push({ channel: channelRow.name, ok: false, error: err.message });
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(config.sendDelayMs);
  }
  return results;
}

module.exports = { init, broadcast, broadcastText, broadcastToAllChannels, normalizeChannel };
