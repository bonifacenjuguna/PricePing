const config = require('../config');
const logger = require('../utils/logger');
const { BBTB_LABELS } = require('../views/bbtb');

// Read-only commands a viewer (VIEWER_TELEGRAM_IDS) may run directly.
// Everything else — thresholds, mute, post, channels, captions, resets,
// automation, etc. — is owner-only.
const VIEWER_ALLOWED_COMMANDS = new Set([
  'start', 'help', 'commands', 'status', 'prices', 'history', 'stats',
  'whoami', 'milestones', 'thresholds', 'channels', 'variables',
  'schedules', 'rules',
]);
const VIEWER_ALLOWED_BBTB = new Set(Object.values(BBTB_LABELS));

function isViewerSafeText(text) {
  if (VIEWER_ALLOWED_BBTB.has(text)) return true;
  if (text.startsWith('/')) {
    const command = text.slice(1).split(/[\s@]/)[0].toLowerCase();
    return VIEWER_ALLOWED_COMMANDS.has(command);
  }
  return false; // includes bare-symbol quick-post — that's a mutation, viewers don't get it
}

function isViewerSafeCallback(data) {
  // Every 'nav:' callback only displays a screen — see callbacks.js, where
  // every nav: case calls a *Screen/*Cmd read function, never a mutation.
  // Everything else (threshold:, mute:, post:send, reset:execute, ...) is
  // a real action and stays owner-only.
  return data.startsWith('nav:');
}

// Gate applies ONLY to private chats with the bot. Channel posts (and any
// linked discussion-group updates) come through as updates with ctx.chat.type
// !== 'private' and often no ctx.from at all — those must never get a reply
// here. Scoping the whole gate to private chats only avoids a past bug
// where the "this bot is private" reply leaked into the channel itself.
function accessGate() {
  return async (ctx, next) => {
    const chatType = ctx.chat && ctx.chat.type;
    if (chatType !== 'private') {
      return undefined;
    }

    const fromId = ctx.from && ctx.from.id;
    if (fromId === config.adminId) {
      return next();
    }

    if (fromId && config.viewerIds.includes(fromId)) {
      if (ctx.callbackQuery && ctx.callbackQuery.data) {
        if (isViewerSafeCallback(ctx.callbackQuery.data)) return next();
        try {
          await ctx.answerCbQuery('View-only access — ask the admin to make that change.');
        } catch {
          /* non-fatal */
        }
        return undefined;
      }
      if (ctx.message && typeof ctx.message.text === 'string') {
        if (isViewerSafeText(ctx.message.text)) return next();
        try {
          await ctx.reply('You have view-only access. Ask the admin to make changes.');
        } catch {
          /* non-fatal */
        }
        return undefined;
      }
      return undefined;
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
