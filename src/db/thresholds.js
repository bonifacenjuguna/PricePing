const { pool } = require('./pool');

// Always read fresh — never cached in a JS variable across ticks. See the
// concurrency notes in the project design: Postgres is the single source
// of truth for thresholds, and a single UPDATE completes well within the
// gap between poll ticks, so no locking is needed for a single-admin bot.
//
// threshold_type: 'usd' (absolute $ move since last alert) or 'pct'
// (percentage move since last alert). See poller.js for how each is applied.
async function getAll() {
  const { rows } = await pool.query('SELECT symbol, threshold_usd, threshold_type FROM thresholds');
  const map = {};
  for (const row of rows) {
    map[row.symbol] = { value: Number(row.threshold_usd), type: row.threshold_type || 'usd' };
  }
  return map;
}

async function get(symbol) {
  const { rows } = await pool.query(
    'SELECT threshold_usd, threshold_type FROM thresholds WHERE symbol = $1',
    [symbol]
  );
  if (!rows.length) return null;
  return { value: Number(rows[0].threshold_usd), type: rows[0].threshold_type || 'usd' };
}

async function set(symbol, thresholdValue, type = 'usd') {
  await pool.query(
    `INSERT INTO thresholds (symbol, threshold_usd, threshold_type, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (symbol) DO UPDATE SET threshold_usd = $2, threshold_type = $3, updated_at = now()`,
    [symbol, thresholdValue, type]
  );
}

// Ensures a row exists for a coin (used when /addcoin creates a new symbol).
async function ensureDefault(symbol, thresholdValue, type = 'usd') {
  await pool.query(
    `INSERT INTO thresholds (symbol, threshold_usd, threshold_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, thresholdValue, type]
  );
}

module.exports = { getAll, get, set, ensureDefault };
