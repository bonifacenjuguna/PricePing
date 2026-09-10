// Transient confirmations ("✅ Threshold updated") that auto-delete after a
// few seconds instead of permanently cluttering the chat. Also a safeEdit
// helper so editing a stale/already-edited message doesn't throw and break
// the flow — Telegram errors on "message not modified" and on messages
// too old to edit; both are swallowed here since the caller's UI intent is
// already satisfied either way (nothing to change / already correct).
const logger = require('../lib/logger');

const AUTO_DELETE_MS = 4000;

async function sendEphemeral(ctx, text) {
  try {
    const msg = await ctx.reply(text);
    setTimeout(() => {
      ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }, AUTO_DELETE_MS);
  } catch (err) {
    logger.warn('Ephemeral message failed to send', { message: err.message });
  }
}

// Edits the current callback-query message's text + inline keyboard. Falls
// back to a fresh reply if the edit fails (e.g. message too old, or content
// identical — Telegram's "not modified" error is swallowed silently).
async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err.description && err.description.includes('not modified')) return;
    logger.warn('safeEdit failed, sending fresh message instead', { message: err.message });
    await ctx.reply(text, extra);
  }
}

module.exports = { sendEphemeral, safeEdit };
