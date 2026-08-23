// Parses simple shorthand durations like "30m", "2h", "1d" into milliseconds.
// Returns null if the string doesn't match (caller decides how to handle that
// — usually "treat as indefinite" or "reject with a usage message").
const UNIT_MS = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseDuration(str) {
  if (!str) return null;
  const match = String(str)
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)(m|h|d)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * UNIT_MS[unit];
}

// Inverse — used to display a countdown like "2h 15m" for /status, /mute, etc.
function formatRemaining(ms) {
  if (ms <= 0) return 'now';
  const totalMinutes = Math.ceil(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = { parseDuration, formatRemaining };
