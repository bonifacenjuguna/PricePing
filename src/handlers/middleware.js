const config = require('../config');
const logger = require('../utils/logger');

// Gate applies ONLY to private chats with the bot. Channel posts (and any
// linked discussion-group updates) come through as updates with ctx.chat.type
// !== 'private' and often no ctx.from at all — those must never get a reply
// here. The previous version replied unconditionally whenever the sender
// wasn't the admin, which meant channel_post updates (delivered because the
// bot is a channel admin, not because "someone" sent them) triggered a
// "this bot is private" reply INTO THE CHANNEL ITSELF. Fixed by scoping the
// whole gate to private chats only.
function accessGate() {
  return async (ctx, next) => {
    const chatType = ctx.chat && ctx.chat.type;

    // Not a private 1:1 chat (channel post, group, etc.) — this bot has no
    // business processing or replying to those. Silently ignore.
    if (chatType !== 'private') {
      return undefined;
    }

    const fromId = ctx.from && ctx.from.id;
    if (fromId === config.adminId) {
      return next();
    }

    if (fromId) {
      logger.warn('Ignored update from non-admin user', { fromId });
    }
    try {
      await ctx.reply('This bot is private.');
    } catch {
      /* non-fatal */
    }
    return undefined;
  };
}

module.exports = { accessGate };
