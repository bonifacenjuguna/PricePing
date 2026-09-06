// Shared number formatting — used by cardRenderer.js, chartRenderer.js,
// and templateEngine.js exactly as before. Kept as its own module so all
// three agree on what a price/pct/change "looks like" everywhere it's
// printed, on-image or in-caption.

// Prices under $1 need more decimal precision to not round to nothing
// (e.g. DOGE, SHIB-style tokens); prices over $1 look cleaner with the
// usual 2 decimals and thousands separators.
function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (value >= 0.01) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  return value.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

function formatPct(pct) {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatChangeUsd(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${formatPrice(Math.abs(value))}`;
}

function directionSymbol(direction) {
  return direction === 'up' ? '▲' : '▼';
}

module.exports = { formatPrice, formatPct, formatChangeUsd, directionSymbol };
