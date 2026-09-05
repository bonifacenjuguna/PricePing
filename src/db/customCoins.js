const { pool } = require('./pool');

async function getAll() {
  const { rows } = await pool.query(
    'SELECT symbol, name, binance_pair, color, is_stable, source FROM custom_coins ORDER BY added_at ASC'
  );
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    binancePair: r.binance_pair,
    color: r.color,
    isStable: r.is_stable,
    milestoneStep: null, // custom coins opt out of milestone alerts by default
    source: r.source || 'manual',
  }));
}

// source: 'manual' (default, via /addcoin) or 'autosync' (via
// services/coinSync.js) — see migrations/011_v0_10_0.sql for why this
// matters: auto-sync is only ever allowed to remove a coin it added itself.
async function add({ symbol, name, binancePair, color, isStable, source }) {
  await pool.query(
    `INSERT INTO custom_coins (symbol, name, binance_pair, color, is_stable, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, name, binancePair, color, !!isStable, source === 'autosync' ? 'autosync' : 'manual']
  );
}

async function remove(symbol) {
  await pool.query('DELETE FROM custom_coins WHERE symbol = $1', [symbol]);
}

module.exports = { getAll, add, remove };
