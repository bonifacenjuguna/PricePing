/**
 * Ephemeral messages — "flash, then vanish." Generalizes the exact pattern
 * Filter/Sort already used (edit a confirmation, delete it ~800ms later,
 * show the real result underneath) into a reusable helper for low-stakes
 * confirmations that would otherwise pile up forever in the chat.
 *
 * IMPORTANT — BBTB markers are the one thing this must NOT auto-delete.
 * An earlier version of this file assumed a Telegram reply keyboard (BBTB)
 * is purely chat-level and survives deletion of the message that
 * introduced it. That assumption was wrong in practice: deleting the
 * message carrying a reply_markup keyboard causes Telegram clients to
 * collapse/hide that keyboard (this is exactly what was reported as "the
 * BBTB tries to disappear, then disappears completely" — the 2.5s timer
 * firing and taking the keyboard down with it). So: any message sent with
 * a reply keyboard (a bbtb.* markup) is intentionally sent as permanent,
 * matching how v0.6.0 always did it — only messages with no keyboard (or
 * an inline keyboard attached to that same message) are safe to auto-delete.
 *
 * What this is deliberately NOT used for: errors/warnings, anything that
 * functions as a receipt (delete/restore/export results, bulk-run
 * summaries), messages with a document attached, or actual content
 * screens. Those all stay permanent — see the file-by-file call sites for
 * which category each message falls into.
 */

const DEFAULT_DELAY_MS = 2500;

/** True if `extra` would attach a Telegram custom reply keyboard (BBTB) —
 * i.e. Markup.keyboard(...), as opposed to no markup or an inline_keyboard
 * attached to the message itself. */
function carriesReplyKeyboard(extra) {
  return !!(extra && extra.reply_markup && extra.reply_markup.keyboard);
}

/** Sends a message and, unless it carries a BBTB reply keyboard, schedules
 * its own deletion. Use for low-stakes confirmations — never for anything
 * the person might want to scroll back to. Failure to delete (message
 * already gone, chat cleared, etc.) is silently ignored — it was only ever
 * a tidiness step, never something the rest of the flow depends on. */
async function sendEphemeral(ctx, text, extra = {}, delayMs = DEFAULT_DELAY_MS) {
  const msg = await ctx.reply(text, extra);
  if (!carriesReplyKeyboard(extra)) {
    scheduleDelete(ctx, msg.message_id, delayMs);
  }
  return msg;
}

/** Schedules deletion of an already-sent message by id — for the rarer
 * case where the message itself needs to be built/edited a specific way
 * before it's safe to just fire-and-forget through sendEphemeral. */
function scheduleDelete(ctx, messageId, delayMs = DEFAULT_DELAY_MS) {
  const chatId = ctx.chat.id;
  setTimeout(() => {
    ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});
  }, delayMs).unref();
}

module.exports = { sendEphemeral, scheduleDelete, carriesReplyKeyboard, DEFAULT_DELAY_MS };
