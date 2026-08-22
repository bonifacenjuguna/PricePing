const { pool } = require('./pool');

// Always read fresh — never cached in a JS variable across ticks. See the
// concurrency notes in the project design: Postgres is the single source
// of truth for thresholds, and a single UPDATE completes well within the
// gap between poll ticks, so no locking is needed for a single-admin bot.
async function getAll() {
  const { rows } = await pool.query('SELECT symbol, threshold_usd FROM thresholds');
  const map = {};
  for (const row of rows) {
    map[row.symbol] = Number(row.threshold_usd);
  }
  return map;
}

async function get(symbol) {
  const { rows } = await pool.query('SELECT threshold_usd FROM thresholds WHERE symbol = $1', [
    symbol,
  ]);
  if (!rows.length) return null;
  return Number(rows[0].threshold_usd);
}

async function set(symbol, thresholdUsd) {
  await pool.query(
    `INSERT INTO thresholds (symbol, threshold_usd, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (symbol) DO UPDATE SET threshold_usd = $2, updated_at = now()`,
    [symbol, thresholdUsd]
  );
}

module.exports = { getAll, get, set };
