const { pool } = require('./pool');

async function getAll() {
  const { rows } = await pool.query(
    'SELECT symbol, name, binance_pair, color, is_stable FROM custom_coins ORDER BY added_at ASC'
  );
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    binancePair: r.binance_pair,
    color: r.color,
    isStable: r.is_stable,
    milestoneStep: null, // custom coins opt out of milestone alerts by default
  }));
}

async function add({ symbol, name, binancePair, color, isStable }) {
  await pool.query(
    `INSERT INTO custom_coins (symbol, name, binance_pair, color, is_stable)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, name, binancePair, color, !!isStable]
  );
}

async function remove(symbol) {
  await pool.query('DELETE FROM custom_coins WHERE symbol = $1', [symbol]);
}

module.exports = { getAll, add, remove };
