const { pool } = require('./pool');
const config = require('../config');

function factoryDefault(symbol) {
  const coin = config.coins.find((c) => c.symbol === symbol);
  return coin ? coin.milestoneStep : null;
}

// Merges DB overrides with the factory defaults from src/coins.js.
// Returns Map<symbol, { step: number|null, isCustom: boolean, isDisabled: boolean }>
// step === null means "no milestones for this coin" (either it never had a
// factory default, e.g. stablecoins, or it's been explicitly disabled).
async function getAll() {
  const { rows } = await pool.query('SELECT symbol, step_value, disabled FROM milestone_overrides');
  const overrides = new Map(rows.map((r) => [r.symbol, { stepValue: r.step_value === null ? null : Number(r.step_value), disabled: r.disabled }]));

  const map = new Map();
  for (const coin of config.coins) {
    const override = overrides.get(coin.symbol);
    if (override) {
      map.set(coin.symbol, {
        step: override.disabled ? null : override.stepValue,
        isCustom: !override.disabled && override.stepValue !== null,
        isDisabled: override.disabled,
      });
    } else {
      map.set(coin.symbol, { step: coin.milestoneStep, isCustom: false, isDisabled: false });
    }
  }
  return map;
}

async function getEffectiveStep(symbol) {
  const { rows } = await pool.query('SELECT step_value, disabled FROM milestone_overrides WHERE symbol = $1', [symbol]);
  if (!rows.length) return factoryDefault(symbol);
  if (rows[0].disabled) return null;
  return rows[0].step_value === null ? factoryDefault(symbol) : Number(rows[0].step_value);
}

async function set(symbol, stepValue) {
  await pool.query(
    `INSERT INTO milestone_overrides (symbol, step_value, disabled, updated_at)
     VALUES ($1, $2, false, now())
     ON CONFLICT (symbol) DO UPDATE SET step_value = $2, disabled = false, updated_at = now()`,
    [symbol, stepValue]
  );
}

async function disable(symbol) {
  await pool.query(
    `INSERT INTO milestone_overrides (symbol, step_value, disabled, updated_at)
     VALUES ($1, NULL, true, now())
     ON CONFLICT (symbol) DO UPDATE SET disabled = true, updated_at = now()`,
    [symbol]
  );
}

// Reverts to the factory default from coins.js (removes the override row).
async function clear(symbol) {
  await pool.query('DELETE FROM milestone_overrides WHERE symbol = $1', [symbol]);
}

async function clearAll() {
  await pool.query('DELETE FROM milestone_overrides');
}

module.exports = { getAll, getEffectiveStep, set, disable, clear, clearAll, factoryDefault };
