const { pool } = require('./pool');

async function get(alertType) {
  const { rows } = await pool.query('SELECT template FROM caption_templates WHERE alert_type = $1', [alertType]);
  return rows.length ? rows[0].template : null; // null -> caller falls back to the built-in default
}

async function getAll() {
  const { rows } = await pool.query('SELECT alert_type, template FROM caption_templates');
  const map = {};
  for (const row of rows) map[row.alert_type] = row.template;
  return map;
}

async function set(alertType, template) {
  await pool.query(
    `INSERT INTO caption_templates (alert_type, template, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (alert_type) DO UPDATE SET template = $2, updated_at = now()`,
    [alertType, template]
  );
}

async function reset(alertType) {
  await pool.query('DELETE FROM caption_templates WHERE alert_type = $1', [alertType]);
}

module.exports = { get, getAll, set, reset };
