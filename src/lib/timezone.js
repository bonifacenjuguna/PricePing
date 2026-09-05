/**
 * Timezone conversion using only Node's built-in `Intl` — no date library
 * dependency (no network access in the dev environment to install/verify
 * one). Node's Intl can *format* a Date in any IANA zone out of the box,
 * but can't *parse* "this local time in that zone" back to UTC on its own,
 * so zonedTimeToUtc() does that with a standard guess-and-correct pass:
 * render a candidate UTC instant in the target zone, measure how far off
 * it is from the intended local time, and correct by that difference.
 * Verified against known UTC offsets including DST transitions (Europe/
 * London BST vs GMT) before this was relied on for anything.
 */

const COMMON_ZONES = [
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/Denver', label: 'Denver' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Sao_Paulo', label: 'São Paulo' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Europe/Moscow', label: 'Moscow' },
  { id: 'Africa/Lagos', label: 'Lagos' },
  { id: 'Africa/Nairobi', label: 'Nairobi' },
  { id: 'Africa/Cairo', label: 'Cairo' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Kolkata', label: 'Mumbai/Delhi' },
  { id: 'Asia/Shanghai', label: 'Shanghai' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' },
];

/** Converts a "YYYY-MM-DD" + "HH:MM" pair, understood as local time in
 * `timeZone`, into the correct UTC Date. Two correction passes handle the
 * (rare) case where the first correction crosses a DST boundary itself. */
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi));

  for (let i = 0; i < 2; i++) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
    const renderedAsUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, parts.hour === '24' ? 0 : +parts.hour, +parts.minute);
    const intendedAsUTC = Date.UTC(y, mo - 1, d, h, mi);
    guess = new Date(guess.getTime() + (intendedAsUTC - renderedAsUTC));
  }
  return guess;
}

/** Formats a UTC Date as local date+time text in the given zone. */
function formatInZone(date, timeZone, { withDate = true } = {}) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    ...(withDate ? { dateStyle: 'medium' } : {}),
    timeStyle: 'short',
  }).format(date);
}

/** Validates an IANA zone name the cheap way — ask Intl to use it and see
 * if it throws, rather than shipping our own list of every valid zone. */
function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { COMMON_ZONES, zonedTimeToUtc, formatInZone, isValidTimeZone };
