/**
 * Guards against a "stale confirm/cancel button" class of problem across
 * every confirm/cancel flow (Delete Repo, Delete File, Bulk Actions,
 * Toggle Visibility, Disconnect, Fork, Storage Clear).
 *
 * The risk this avoids: if a confirm/cancel handler sent a brand-new
 * "Cancelled." message instead of touching the original confirmation
 * message, Telegram inline buttons would stay live until THAT message is
 * edited — so tapping Cancel, then going back and tapping the original
 * Confirm, could still fire the action.
 *
 * The design is structural, not a per-flow patch: every confirm/cancel
 * screen goes through `resolveConfirmation`, which edits the SAME message
 * that held the buttons — stripping the keyboard and replacing the text
 * with the outcome — the instant either button is tapped. Once a message
 * is resolved, its buttons are gone; there is no message left for a stale
 * tap to land on. Any confirm/cancel flow that calls this helper gets
 * that guarantee automatically, with no per-flow work needed.
 */

/**
 * @param {object} ctx - Telegraf context (must be a callback_query update)
 * @param {'confirmed'|'cancelled'} outcome
 * @param {string} resolvedText - what the message becomes once resolved
 * @param {object} [opts]
 * @param {string} [opts.parse_mode] - defaults to none (plain text)
 */
async function resolveConfirmation(ctx, outcome, resolvedText, opts = {}) {
  try {
    await ctx.editMessageText(resolvedText, {
      parse_mode: opts.parse_mode,
      // No reply_markup at all — this is what actually removes the buttons.
    });
  } catch (err) {
    // Message too old to edit (Telegram's ~48h window) or already edited by
    // a race — fall back to a plain reply so the person still sees the
    // outcome, even though we couldn't retroactively disarm the old buttons.
    await ctx.reply(resolvedText, { parse_mode: opts.parse_mode });
  }
}

module.exports = { resolveConfirmation };
