const { pool } = require('./pool');

// coins table (see migrations/010_v1_0_0.sql) is now the single source of
// truth for every tracked coin — populated and kept in sync automatically
// by services/binanceSync.js. No more manual /addcoin.

async function getAll() {
  const res = await pool.query('SELECT * FROM coins ORDER BY tier, symbol ASC');
  return res.rows;
}

async function get(symbol) {
  const res = await pool.query('SELECT * FROM coins WHERE symbol = $1', [symbol.toUpperCase()]);
  return res.rows[0] || null;
}

// Called by binanceSync.js for every pair it finds. Inserts a brand-new
// coin with sane defaults, or just bumps last_seen_at + refreshes
// tier/price-derived fields for one already tracked — never touches
// muted/threshold overrides an owner has already set, since those are
// deliberate choices, not sync-derived data.
async function upsertFromSync({ symbol, name, binancePair, color, isStable, milestoneStep, tier, defaultThresholdValue, defaultThresholdType }) {
  await pool.query(
    `INSERT INTO coins (symbol, name, binance_pair, color, is_stable, milestone_step, tier, threshold_value, threshold_type, first_seen_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
     ON CONFLICT (symbol) DO UPDATE SET
       name = EXCLUDED.name,
       binance_pair = EXCLUDED.binance_pair,
       color = EXCLUDED.color,
       is_stable = EXCLUDED.is_stable,
       milestone_step = EXCLUDED.milestone_step,
       tier = EXCLUDED.tier,
       last_seen_at = now()`,
    [symbol, name, binancePair, color, isStable, milestoneStep, tier, defaultThresholdValue, defaultThresholdType]
  );
}

// A coin that no longer shows up in Binance's exchangeInfo (delisted) —
// removed from tracking and its logo file cleanup is handled by the
// caller (binanceSync.js), same pattern as the old removeCoin().
async function remove(symbol) {
  await pool.query('DELETE FROM coins WHERE symbol = $1', [symbol.toUpperCase()]);
}

async function setThresholdOverride(symbol, value, type) {
  await pool.query('UPDATE coins SET threshold_value = $2, threshold_type = $3 WHERE symbol = $1', [
    symbol.toUpperCase(),
    value,
    type,
  ]);
}

async function setMuted(symbol, muted) {
  await pool.query('UPDATE coins SET muted = $2 WHERE symbol = $1', [symbol.toUpperCase(), muted]);
}

async function setLastPrice(symbol, price) {
  await pool.query('UPDATE coins SET last_price = $2, last_alert_price = COALESCE(last_alert_price, $2) WHERE symbol = $1', [
    symbol.toUpperCase(),
    price,
  ]);
}

async function setLastAlertPrice(symbol, price) {
  await pool.query('UPDATE coins SET last_alert_price = $2 WHERE symbol = $1', [symbol.toUpperCase(), price]);
}

module.exports = {
  getAll,
  get,
  upsertFromSync,
  remove,
  setThresholdOverride,
  setMuted,
  setLastPrice,
  setLastAlertPrice,
};
