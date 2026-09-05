const { pool } = require('./pool');

// Always read fresh — never cached in a JS variable across ticks. See the
// concurrency notes in the project design: Postgres is the single source
// of truth for thresholds, and a single UPDATE completes well within the
// gap between poll ticks, so no locking is needed for a single-admin bot.
//
// threshold_type: 'usd' (absolute $ move since last alert) or 'pct'
// (percentage move since last alert). See poller.js for how each is applied.
// is_custom: true once the admin has explicitly set this coin's threshold
// (via set()) — false only for a still-untouched seeded default
// (ensureDefault()). Bot Modes scale defaults, never a custom value —
// see db/settings.js and poller.js.
async function getAll() {
  const { rows } = await pool.query('SELECT symbol, threshold_usd, threshold_type, is_custom FROM thresholds');
  const map = {};
  for (const row of rows) {
    map[row.symbol] = { value: Number(row.threshold_usd), type: row.threshold_type || 'usd', isCustom: !!row.is_custom };
  }
  return map;
}

async function get(symbol) {
  const { rows } = await pool.query(
    'SELECT threshold_usd, threshold_type, is_custom FROM thresholds WHERE symbol = $1',
    [symbol]
  );
  if (!rows.length) return null;
  return { value: Number(rows[0].threshold_usd), type: rows[0].threshold_type || 'usd', isCustom: !!rows[0].is_custom };
}

// Always marks the threshold custom — calling set() is, by definition, an
// explicit choice (typed by the admin, applied via bulk edit, or restored
// from an import). Pass isCustom: false only for the "reset to factory
// default" path, where the point is specifically to go back to a
// mode-scalable default.
async function set(symbol, thresholdValue, type = 'usd', isCustom = true) {
  await pool.query(
    `INSERT INTO thresholds (symbol, threshold_usd, threshold_type, is_custom, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (symbol) DO UPDATE SET threshold_usd = $2, threshold_type = $3, is_custom = $4, updated_at = now()`,
    [symbol, thresholdValue, type, isCustom]
  );
}

// Ensures a row exists for a coin (used when /addcoin creates a new symbol).
// Always seeded as NOT custom — this is the bot's own default, exactly the
// case Bot Modes are meant to scale.
async function ensureDefault(symbol, thresholdValue, type = 'usd') {
  await pool.query(
    `INSERT INTO thresholds (symbol, threshold_usd, threshold_type, is_custom)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, thresholdValue, type]
  );
}

module.exports = { getAll, get, set, ensureDefault };
