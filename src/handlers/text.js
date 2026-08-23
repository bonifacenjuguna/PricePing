const config = require('../config');
const { BBTB_LABELS } = require('../views/bbtb');
const commands = require('./commands');

async function onText(ctx) {
  const text = ctx.message && ctx.message.text;
  if (!text) return undefined;

  switch (text) {
    case BBTB_LABELS.home:
      return commands.home(ctx);
    case BBTB_LABELS.prices:
      return commands.pricesCmd(ctx);
    case BBTB_LABELS.thresholds:
      return commands.thresholdsCmd(ctx);
    case BBTB_LABELS.stats:
      return commands.statsCmd(ctx);
    default:
      break;
  }

  // Bare coin symbol typed on its own (e.g. "BTC") -> quick manual post to
  // the channel. Checked against the live coin list (includes anything
  // added via /addcoin), not just the static 10, and only matches a
  // single-word message so normal free text still falls through below.
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
  return ctx.reply('Use the menu below, /post SYMBOL, or /help for the full command list.');
}

module.exports = { onText };
