const { pool } = require('./pool');

// Caption template overrides — key is either "type" (e.g. "threshold") or
// "type:SYMBOL" (e.g. "threshold:BTC"), matching templateEngine.js's
// lookup order (symbol-specific, then type-wide, then DEFAULT_TEMPLATES).

async function get(key) {
  const res = await pool.query('SELECT template FROM templates WHERE key = $1', [key]);
  return res.rows.length ? res.rows[0].template : null;
}

async function set(key, template) {
  await pool.query(
    `INSERT INTO templates (key, template) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET template = EXCLUDED.template`,
    [key, template]
  );
}

async function reset(key) {
  await pool.query('DELETE FROM templates WHERE key = $1', [key]);
}

module.exports = { get, set, reset };
