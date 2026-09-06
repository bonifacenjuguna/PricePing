// Telegram only allows ONE reply_markup per message — inline_keyboard and
// a persistent reply keyboard can't coexist on the same send. Screens are
// reachable two ways: tapping an inline button (edit the existing message)
// or tapping a BBTB shortcut, which arrives as a plain text message (must
// send a fresh message instead — there's nothing to edit).
async function renderScreen(ctx, text, extra) {
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch (err) {
      // "message not modified" or the original message aged out — fall
      // back to a fresh send rather than surfacing a Telegram API error.
      return ctx.reply(text, extra);
    }
  }
  return ctx.reply(text, extra);
}

module.exports = renderScreen;
