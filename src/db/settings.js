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

async function isPaused() {
  const val = await get('paused');
  return val === 'true';
}

async function setPaused(paused) {
  await set('paused', paused ? 'true' : 'false');
}

async function isAnnouncementSent() {
  const val = await get('announcement_sent');
  return val === 'true';
}

async function markAnnouncementSent() {
  await set('announcement_sent', 'true');
}

module.exports = { get, set, isPaused, setPaused, isAnnouncementSent, markAnnouncementSent };
