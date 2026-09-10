// Formats a price with sensible decimal precision depending on magnitude —
// $78,500 doesn't need decimals, $0.000123 (a low-cap coin) needs several.
function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatPct(pct) {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function directionSymbol(direction) {
  return direction === 'up' ? '▲' : '▼';
}

function successMessage(text) {
  return `✅ ${text}`;
}

function errorMessage(title, detail, hint) {
  let msg = `❌ *${title}*`;
  if (detail) msg += `\n${detail}`;
  if (hint) msg += `\n\n💡 ${hint}`;
  return msg;
}

module.exports = { formatPrice, formatPct, directionSymbol, successMessage, errorMessage };
