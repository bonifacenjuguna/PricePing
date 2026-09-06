const bbtb = require('../keyboards/bbtb');
const pendingInput = require('../services/pendingInput');
const coinsDb = require('../db/coins');
const settingsDb = require('../db/settings');
const channelsDb = require('../db/channels');
const templatesDb = require('../db/templates');
const timezoneService = require('../services/timezoneService');
const config = require('../config');

async function handleCancel(ctx) {
  await pendingInput.clear();
  await ctx.reply('Cancelled.', bbtb.mainMenu);
}

async function handleText(ctx) {
  const text = ctx.message.text.trim();

  if (text === '❌ Cancel') return handleCancel(ctx);

  const action = await pendingInput.get();
  if (!action) return; // no pending input expected — ignore stray text, keeps the bot silent to noise

  const parts = action.split(':');

  try {
    if (action.startsWith('coin:threshold:')) {
      const symbol = parts[2];
      const value = Number(text);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Send a positive number.');
      await coinsDb.setThresholdOverride(symbol, value, 'pct');
      await ctx.reply(`✅ Threshold for ${symbol} set to ${value}%.`, bbtb.mainMenu);
    } else if (action.startsWith('threshold:tier:')) {
      const tier = parts[2];
      const value = Number(text);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Send a positive number.');
      await settingsDb.set(`tier_${tier}_pct`, value);
      await ctx.reply(`✅ ${tier} tier default set to ${value}%.`, bbtb.mainMenu);
    } else if (action === 'channel:add') {
      const chatId = text.startsWith('@') || text.startsWith('-') ? text : `@${text}`;
      try {
        await ctx.telegram.sendMessage(chatId, '✅ PricePing connected to this channel.', { disable_notification: true });
      } catch (err) {
        throw new Error(`Could not post to ${chatId} — make sure the bot is an admin there. (${err.message})`);
      }
      const name = chatId.replace(/^[@-]/, '').toLowerCase();
      await channelsDb.addChannel(name, chatId);
      await ctx.reply(`✅ Channel "${name}" added.`, bbtb.mainMenu);
    } else if (action.startsWith('format:setnew:')) {
      const alertType = parts[2];
      await templatesDb.set(alertType, text);
      await ctx.reply(`✅ Template for "${alertType}" updated.`, bbtb.mainMenu);
    } else if (action === 'bot:timezone:set') {
      await timezoneService.setTimezone(text);
      await ctx.reply(`✅ Timezone set to ${text}.`, bbtb.mainMenu);
    } else if (action === 'post:search') {
      const coin = await coinsDb.get(text.toUpperCase());
      if (!coin) throw new Error(`"${text}" isn't currently tracked.`);
      const inline = require('../keyboards/inline');
      await ctx.reply(`<b>${coin.symbol}</b> — post as what?`, {
        parse_mode: 'HTML',
        ...inline.manualPostTypeChoice(coin.symbol),
      });
    } else {
      await ctx.reply('Unrecognized pending action — cancelled.', bbtb.mainMenu);
    }
  } catch (err) {
    await ctx.reply(`⚠️ ${err.message}`, bbtb.cancelOnly);
    return; // keep pending state so they can retry
  }

  await pendingInput.clear();
}

module.exports = { handleText, handleCancel };
