const { pool } = require('./pool');

function mapRow(r) {
  return {
    id: r.id,
    triggerType: r.trigger_type,
    triggerSymbol: r.trigger_symbol,
    actionType: r.action_type,
    actionParams: r.action_params || {},
    enabled: r.enabled,
  };
}

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM rules ORDER BY id ASC');
  return rows.map(mapRow);
}

async function getEnabled() {
  const { rows } = await pool.query('SELECT * FROM rules WHERE enabled = true ORDER BY id ASC');
  return rows.map(mapRow);
}

async function add({ triggerType, triggerSymbol, actionType, actionParams }) {
  const { rows } = await pool.query(
    `INSERT INTO rules (trigger_type, trigger_symbol, action_type, action_params)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [triggerType, triggerSymbol || null, actionType, JSON.stringify(actionParams || {})]
  );
  return rows[0].id;
}

async function remove(id) {
  await pool.query('DELETE FROM rules WHERE id = $1', [id]);
}

async function setEnabled(id, enabled) {
  await pool.query('UPDATE rules SET enabled = $2 WHERE id = $1', [id, enabled]);
}

module.exports = { getAll, getEnabled, add, remove, setEnabled };
