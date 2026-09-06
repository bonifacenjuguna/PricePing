const { pool } = require('./pool');

// Owner-defined extra {vars} usable in caption templates — never allowed
// to shadow a built-in name (enforced in templateEngine.js, not here).

async function getAll() {
  const res = await pool.query('SELECT name, value FROM custom_vars');
  const map = {};
  for (const row of res.rows) map[row.name] = row.value;
  return map;
}

async function set(name, value) {
  await pool.query(
    `INSERT INTO custom_vars (name, value) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [name, value]
  );
}

async function remove(name) {
  await pool.query('DELETE FROM custom_vars WHERE name = $1', [name]);
}

module.exports = { getAll, set, remove };
