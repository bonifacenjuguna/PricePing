const config = require('../config');
const settingsDb = require('../db/settings');

// No date-fns-tz/moment-timezone dependency needed — Node 18+ ships full
// ICU by default, so Intl.DateTimeFormat already knows every IANA zone.

async function getTimezone() {
  const stored = await settingsDb.get('timezone');
  return stored || config.defaultTimezone;
}

async function setTimezone(tz) {
  // Throws if `tz` isn't a real IANA zone name — caller should catch this
  // to reject bad free-text input before saving it.
  Intl.DateTimeFormat('en-US', { timeZone: tz });
  await settingsDb.set('timezone', tz);
}

// Returns { hour, minute, weekday } for "now" as observed in the given
// timezone — weekday is 0 (Sun) - 6 (Sat), matching JS Date.getDay().
function getPartsInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    weekday: weekdayNames.indexOf(map.weekday),
  };
}

module.exports = { getTimezone, setTimezone, getPartsInTz };
