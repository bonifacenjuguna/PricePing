const { pool } = require('./postgres');

async function getAll() {
  const { rows } = await pool.query('SELECT name, value FROM custom_vars');
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

async function set(name, value) {
  await pool.query(
    `INSERT INTO custom_vars (name, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (name) DO UPDATE SET value = $2, updated_at = now()`,
    [name, value]
  );
}

async function remove(name) {
  await pool.query('DELETE FROM custom_vars WHERE name = $1', [name]);
}

module.exports = { getAll, set, remove };
