const { pool } = require('./postgres');

async function get(key) {
  const { rows } = await pool.query('SELECT value FROM templates WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO templates (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value]
  );
}

async function reset(key) {
  await pool.query('DELETE FROM templates WHERE key = $1', [key]);
}

async function getAll() {
  const { rows } = await pool.query('SELECT key, value FROM templates');
  return new Map(rows.map((r) => [r.key, r.value]));
}

module.exports = { get, set, reset, getAll };
