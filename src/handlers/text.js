const config = require('../config');
const { BBTB_LABELS, bbtbDefault, bbtbMarkets } = require('../views/bbtb');
const commands = require('./commands');
const pendingInput = require('../services/pendingInput');
const bbtbState = require('../services/bbtbState');

async function onText(ctx) {
  const text = ctx.message && ctx.message.text;
  if (!text) return undefined;

  // A button somewhere set up a guided free-text prompt (add coin, add
  // channel, edit a caption, etc.) — whatever comes next belongs to that
  // flow, not to the normal menu/symbol handling below. Cleared either way
  // so a stray follow-up message doesn't accidentally re-trigger it.
  const pending = pendingInput.get();
  if (pending) {
    pendingInput.clear();
    return commands.handleGuidedInput(ctx, pending);
  }

  switch (text) {
    case BBTB_LABELS.home:
      // Only send a keyboard-swap message on an actual transition, not on
      // every repeated tap while already on the default layout.
      if (bbtbState.get() !== 'default') {
        bbtbState.set('default');
        await ctx.reply('\uD83C\uDFE0 Main menu.', bbtbDefault);
      }
      return commands.home(ctx);
    case BBTB_LABELS.prices:
      return commands.pricesCmd(ctx);
    case BBTB_LABELS.thresholds:
      return commands.thresholdsCmd(ctx);
    case BBTB_LABELS.stats:
      return commands.statsCmd(ctx);
    case BBTB_LABELS.markets:
      if (bbtbState.get() !== 'markets') {
        bbtbState.set('markets');
        await ctx.reply('\uD83D\uDC8E Markets tools \u2014 tap \uD83C\uDFE0 Home below to switch back.', bbtbMarkets);
      }
      return commands.marketsCmd(ctx);
    case BBTB_LABELS.movers:
      return commands.moversCmd(ctx);
    case BBTB_LABELS.coins:
      return commands.coinListScreen(ctx);
    case BBTB_LABELS.feargreed:
      return commands.fearGreedCmd(ctx);
    default:
      break;
  }

  // Bare coin symbol typed on its own (e.g. "BTC") -> quick manual post to
  // the default channel. Checked against the live coin list (includes
  // anything added via /addcoin), not just the static 10, and only
  // matches a single-word message so normal free text still falls through.
  const trimmed = text.trim();
  if (/^[A-Za-z0-9]{2,10}$/.test(trimmed)) {
    const symbol = trimmed.toUpperCase();
    const coin = config.coins.find((c) => c.symbol === symbol);
    if (coin) {
      return commands.manualPost(ctx, symbol);
    }
  }

  // Not a menu button, not a recognized symbol, not a slash command —
  // nudge toward the menu rather than staying silent.
  return ctx.reply('Use /commands for the full menu, /post SYMBOL, or /help for the full command list.');
}

module.exports = { onText };
