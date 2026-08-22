// Picks a sensible number of decimal places based on price magnitude, so
// BTC shows as "$109,842" and DOGE shows as "$0.08234" without a
// per-coin lookup table to maintain.
function decimalsFor(price) {
  const abs = Math.abs(price);
  if (abs >= 100) return 2;
  if (abs >= 1) return 4;
  return 6;
}

function formatPrice(price) {
  if (price === null || price === undefined || Number.isNaN(price)) return '—';
  const decimals = decimalsFor(price);
  return Number(price).toLocaleString('en-US', {
    minimumFractionDigits: decimals >= 2 ? 2 : decimals,
    maximumFractionDigits: decimals,
  });
}

function formatChangeUsd(changeUsd) {
  if (changeUsd === null || changeUsd === undefined || Number.isNaN(changeUsd)) return '—';
  const decimals = decimalsFor(Math.abs(changeUsd));
  return Math.abs(changeUsd).toLocaleString('en-US', {
    minimumFractionDigits: decimals >= 2 ? 2 : decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPct(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  return `${Math.abs(pct).toFixed(2)}%`;
}

function directionSymbol(direction) {
  return direction === 'up' ? '\u25B2' : '\u25BC'; // ▲ / ▼
}

function timeAgo(date) {
  if (!date) return 'never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

module.exports = { formatPrice, formatChangeUsd, formatPct, directionSymbol, timeAgo };
