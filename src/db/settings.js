const { pool } = require('./pool');

async function get(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

async function remove(key) {
  await pool.query('DELETE FROM settings WHERE key = $1', [key]);
}

async function isPaused() {
  const val = await get('paused');
  return val === 'true';
}

async function setPaused(paused) {
  await set('paused', paused ? 'true' : 'false');
  if (paused === false) await remove('paused_until'); // resuming clears any pending snooze
}

// Global snooze: /pause 2h sets both paused=true and a wake time. The poller
// checks this every tick and auto-resumes once it passes — see poller.js.
async function getPausedUntil() {
  const val = await get('paused_until');
  return val ? new Date(val) : null;
}

async function setPausedUntil(date) {
  await set('paused', 'true');
  await set('paused_until', date.toISOString());
}

async function isAnnouncementSent() {
  const val = await get('announcement_sent');
  return val === 'true';
}

async function markAnnouncementSent() {
  await set('announcement_sent', 'true');
}

async function getSecondaryChannelId() {
  return get('secondary_channel_id');
}

async function setSecondaryChannelId(channelId) {
  if (!channelId) return remove('secondary_channel_id');
  return set('secondary_channel_id', channelId);
}

async function getLastDigestDate() {
  return get('last_digest_date');
}

async function setLastDigestDate(dateStr) {
  return set('last_digest_date', dateStr);
}

// Up to 3 shortcut keys shown as an extra row on Home — see
// views/menu.js's PINNABLE_ACTIONS catalog for the fixed set of choices.
async function getPinnedActions() {
  const raw = await get('pinned_actions');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function setPinnedActions(keys) {
  return set('pinned_actions', JSON.stringify(keys.slice(0, 3)));
}

module.exports = {
  get,
  set,
  remove,
  isPaused,
  setPaused,
  getPausedUntil,
  setPausedUntil,
  isAnnouncementSent,
  markAnnouncementSent,
  getSecondaryChannelId,
  setSecondaryChannelId,
  getLastDigestDate,
  setLastDigestDate,
  getPinnedActions,
  setPinnedActions,
};
