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
      // Not a menu button and not a recognized slash command — nudge
      // toward the menu rather than staying silent.
      return ctx.reply('Use the menu below, or /help for the full command list.');
  }
}

module.exports = { onText };
