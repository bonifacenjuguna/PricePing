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

// Picks a "nice" step size (1/2/5 × a power of 10) close to roughly 10% of
// the current value, instead of an exact-but-fussy 10% — e.g. a $0.02 XRP
// threshold steps by $0.005 instead of $0.002. Used by the ± buttons for
// both thresholds and milestones so nudging never lands on an odd number.
function niceStep(value, minStep = 0.01) {
  if (!Number.isFinite(value) || value <= 0) return minStep;
  const target = value * 0.1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude);
  let best = candidates[0];
  let bestDiff = Math.abs(candidates[0] - target);
  for (const c of candidates) {
    const diff = Math.abs(c - target);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return Math.max(Math.round(best * 1e8) / 1e8, minStep);
}

module.exports = { formatPrice, formatChangeUsd, formatPct, directionSymbol, timeAgo, niceStep };
