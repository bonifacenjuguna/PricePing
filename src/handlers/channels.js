// Telegram fires my_chat_member when the bot's own status changes in a
// chat (added, promoted to admin, demoted, removed). We only care about
// channel/group contexts where the bot ends up as an admin — that's when
// it becomes eligible to auto-post milestone/threshold alerts there.
const channelsDb = require('../db/channels');
const logger = require('../lib/logger');

async function handleMyChatMember(ctx) {
  const update = ctx.myChatMember;
  const chat = update.chat;
  const newStatus = update.new_chat_member.status;
  const isChannelOrGroup = chat.type === 'channel' || chat.type === 'group' || chat.type === 'supergroup';
  if (!isChannelOrGroup) return;

  if (newStatus === 'administrator') {
    await channelsDb.addChannel(chat.id, chat.title, update.from.id, chat.username);
    logger.info('Bot added as admin, channel registered', { chatId: chat.id, title: chat.title });
    try {
      await ctx.telegram.sendMessage(
        update.from.id,
        `✅ Added to *${chat.title}* as admin — alerts are now configurable for this channel from Settings.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      // Adder may not have started a DM with the bot yet — not fatal, they
      // can still configure via the channel's own settings screen later.
      logger.warn('Could not DM channel-add confirmation', { message: err.message });
    }
  } else if (newStatus === 'left' || newStatus === 'kicked' || newStatus === 'member') {
    // 'member' (demoted from admin) also disables posting — deactivate either way
    await channelsDb.removeChannel(chat.id);
    logger.info('Channel deactivated', { chatId: chat.id, newStatus });
  }
}

module.exports = { handleMyChatMember };
