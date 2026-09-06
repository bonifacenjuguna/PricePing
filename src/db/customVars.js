const { pool } = require('./pool');

async function getAll() {
  const { rows } = await pool.query('SELECT name, value FROM custom_vars');
  const map = {};
  for (const row of rows) map[row.name] = row.value;
  return map;
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
