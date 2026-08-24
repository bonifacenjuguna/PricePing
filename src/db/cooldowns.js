const { pool } = require('./pool');
const config = require('../config');

async function getAll() {
  const { rows } = await pool.query('SELECT symbol, cooldown_minutes FROM cooldown_overrides');
  const map = {};
  for (const row of rows) map[row.symbol] = row.cooldown_minutes;
  return map;
}

// Returns the effective cooldown in minutes for one symbol — its override,
// or the global COOLDOWN_MINUTES default.
async function getEffective(symbol) {
  const { rows } = await pool.query('SELECT cooldown_minutes FROM cooldown_overrides WHERE symbol = $1', [symbol]);
  return rows.length ? rows[0].cooldown_minutes : config.cooldownMinutes;
}

async function set(symbol, minutes) {
  await pool.query(
    `INSERT INTO cooldown_overrides (symbol, cooldown_minutes, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (symbol) DO UPDATE SET cooldown_minutes = $2, updated_at = now()`,
    [symbol, minutes]
  );
}

async function clear(symbol) {
  await pool.query('DELETE FROM cooldown_overrides WHERE symbol = $1', [symbol]);
}

async function clearAll() {
  await pool.query('DELETE FROM cooldown_overrides');
}

module.exports = { getAll, getEffective, set, clear, clearAll };
