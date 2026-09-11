// Default caption format, adapted from PricePing's template engine:
//   <b>{name}</b>: ${price}\u00A0@{handle}
// e.g. "**Bitcoin**: $77,000 @yourbot" — bold name, price, and a bot/
// channel handle, sent with parse_mode HTML. This is a fixed default for
// now (not the full per-symbol custom-template system PricePing has with
// /setcaption — that's a bigger feature to add later if wanted), but
// matches the actual default text shape.
const format = require('./format');
const botInfo = require('./botInfo');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// handleOverride: pass a channel's raw @username (no leading @, matching
// Telegram's chat.username convention) to use instead of the bot's own —
// falls back to the bot's handle when the channel has no public username
// (private channels/groups, the normal case).
function buildCaption({ coin, price, handleOverride }) {
  const rawHandle = handleOverride || botInfo.get();
  const handle = rawHandle ? `@${rawHandle}` : '';
  const priceStr = `$${format.formatPrice(price)}`;
  return `<b>${escapeHtml(coin.name)}</b>: ${priceStr}${handle ? `\u00A0${escapeHtml(handle)}` : ''}`;
}

module.exports = { buildCaption };
