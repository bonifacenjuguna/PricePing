const { pool } = require('./pool');

// Same key/value `settings` table that already existed (paused,
// announcement_sent, secondary_channel_id, etc.) — bot_mode and timezone
// just become new keys in it, so DB-overrides-env works exactly like
// digestEnabled/digestHourUtc already did.

async function get(key) {
  const res = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return res.rows.length ? res.rows[0].value : null;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

async function getAll() {
  const res = await pool.query('SELECT key, value FROM settings');
  const map = {};
  for (const row of res.rows) map[row.key] = row.value;
  return map;
}

module.exports = { get, set, getAll };
