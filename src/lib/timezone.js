// Timezone conversion using only Node's built-in Intl — no date library
// dependency. Same pattern reviewed from the gitrohub project: Intl can
// *format* a Date in any IANA zone natively, but can't *parse* "this local
// time in that zone" back to UTC on its own, so zonedTimeToUtc() does a
// guess-and-correct pass.
const COMMON_ZONES = [
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Sao_Paulo', label: 'São Paulo' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Africa/Lagos', label: 'Lagos' },
  { id: 'Africa/Nairobi', label: 'Nairobi' },
  { id: 'Africa/Cairo', label: 'Cairo' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Kolkata', label: 'Mumbai/Delhi' },
  { id: 'Asia/Shanghai', label: 'Shanghai' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' },
];

function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  for (let i = 0; i < 2; i += 1) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
    const renderedAsUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, parts.hour === '24' ? 0 : +parts.hour, +parts.minute);
    const intendedAsUTC = Date.UTC(y, mo - 1, d, h, mi);
    guess = new Date(guess.getTime() + (intendedAsUTC - renderedAsUTC));
  }
  return guess;
}

function formatInZone(date, timeZone, { withDate = true, hour12 = false } = {}) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...(withDate ? { dateStyle: 'medium' } : {}), timeStyle: 'short', hour12 }).format(date);
}

function isValidTimeZone(tz) {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

// 0-23 hour of day in the given zone, for the given instant — used by
// quiet-hours and digest-timing checks so they fire on the CHANNEL's local
// clock, not one shared UTC cutoff.
function getHourInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour').value);
}

// YYYY-MM-DD in the given zone — for "once per local day" dedup markers.
function getDateKeyInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

module.exports = { COMMON_ZONES, zonedTimeToUtc, formatInZone, isValidTimeZone, getHourInZone, getDateKeyInZone };
