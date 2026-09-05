// Schedules and quiet hours are stored as UTC hour/minute (and, for
// weekly schedules, a UTC day-of-week) — see migrations/001_init.sql.
// This converts between that storage format and the admin's configured
// local timezone, so /schedule and /quiethours can be typed and shown in
// local time instead of requiring a mental UTC conversion every time.
//
// Uses Node's built-in Intl (no extra dependency) against "now" to
// determine the UTC offset, which means the offset used matches today's
// DST state for zones that observe it. Known tradeoff: this can be off
// by an hour on the two days a year DST actually changes, for a schedule
// whose fire time falls in the gap — acceptable for a personal ops bot,
// not worth a full recurring-rule timezone engine.

function isValidTimezone(tz) {
  if (!tz) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Offset in minutes of `tz` from UTC right now — positive means ahead of
// UTC (e.g. +60 for UTC+1, -300 for UTC-5).
function offsetMinutes(tz, ref = new Date()) {
  if (tz === 'UTC') return 0;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(ref).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - ref.getTime()) / 60000);
}

// dayOfWeek is optional (0=Sunday..6=Saturday, only meaningful for weekly
// schedules) — pass null/undefined for hourly/daily. Handles the
// conversion crossing a day boundary (e.g. 01:00 in UTC+2 is 23:00 the
// *previous* day in UTC).
function convert(hour, minute, dayOfWeek, offsetSign, tz) {
  if (tz === 'UTC' || !tz) return { hour, minute, dayOfWeek: dayOfWeek ?? null };
  const offset = offsetMinutes(tz) * offsetSign;
  let total = hour * 60 + minute + offset;
  let dayShift = 0;
  if (total < 0) {
    total += 1440;
    dayShift = -1;
  } else if (total >= 1440) {
    total -= 1440;
    dayShift = 1;
  }
  const newDay = dayOfWeek === null || dayOfWeek === undefined ? null : ((dayOfWeek + dayShift) % 7 + 7) % 7;
  return { hour: Math.floor(total / 60), minute: total % 60, dayOfWeek: newDay };
}

// Local wall-clock time (as typed by the admin) -> UTC (for storage).
function localToUtc(hour, minute, tz, dayOfWeek = null) {
  return convert(hour, minute, dayOfWeek, -1, tz);
}

// UTC (as stored) -> local wall-clock time (for display).
function utcToLocal(hour, minute, tz, dayOfWeek = null) {
  return convert(hour, minute, dayOfWeek, 1, tz);
}

function fmtHm(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

module.exports = { isValidTimezone, offsetMinutes, localToUtc, utcToLocal, fmtHm };
