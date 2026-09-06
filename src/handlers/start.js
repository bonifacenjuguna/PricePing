const config = require('../config');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const modes = require('../services/modes');
const coinsDb = require('../db/coins');
const channelsDb = require('../db/channels');
const telegramSender = require('../services/telegramSender');

async function handleStart(ctx) {
  const coins = await coinsDb.getAll();
  const channels = await channelsDb.getAll();
  const mode = await modes.getCurrentMode();

  // Two separate sends on purpose — Telegram allows only one reply_markup
  // per message, so an inline keyboard and the persistent BBTB row can't
  // both be attached to the same message. First message sets the BBTB row
  // (and carries the status summary); second message is the actual
  // navigable inline menu.
  await ctx.reply(
    `◆ <b>PricePing</b>\n\n` +
      `▸ Tracking ${coins.length} coins\n` +
      `▸ Mode: ${mode.label}\n` +
      `▸ Bound to ${channels.length} channel(s)`,
    { parse_mode: 'HTML', ...bbtb.mainMenu }
  );
  await ctx.reply('Tap a button below to get started.', { ...inline.mainMenu });
}

// Called once at boot. DM to the owner is detailed (version/mode/DB
// status/channels); the channel-facing one is a short silent heartbeat —
// a channel audience doesn't need internal health details.
async function announceStartup(bot) {
  const coins = await coinsDb.getAll();
  const channels = await channelsDb.getAll();
  const mode = await modes.getCurrentMode();

  const ownerText =
    `✅ <b>PricePing is online</b>\n\n` +
    `▸ Version: v1.0.0\n` +
    `▸ Mode: ${mode.label}\n` +
    `▸ Tracking: ${coins.length} coins\n` +
    `▸ Channels: ${channels.map((c) => c.name).join(', ') || 'none'}\n` +
    `▸ Database: connected\n` +
    `▸ Redis: connected`;

  try {
    await bot.telegram.sendMessage(config.adminId, ownerText, { parse_mode: 'HTML' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to DM startup announcement to owner', err.message);
  }

  await telegramSender
    .broadcastToAllChannels('✅ PricePing is back online.', { disable_notification: true })
    .catch(() => {});
}

module.exports = { handleStart, announceStartup };
