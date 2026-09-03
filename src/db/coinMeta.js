const { pool } = require('./pool');

async function upsert(symbol, { coingeckoId, marketCapRank }) {
  await pool.query(
    `INSERT INTO coin_meta (symbol, coingecko_id, market_cap_rank, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (symbol) DO UPDATE SET
       coingecko_id = EXCLUDED.coingecko_id,
       market_cap_rank = EXCLUDED.market_cap_rank,
       updated_at = now()`,
    [symbol, coingeckoId || null, Number.isFinite(marketCapRank) ? marketCapRank : null]
  );
}

async function get(symbol) {
  const { rows } = await pool.query('SELECT * FROM coin_meta WHERE symbol = $1', [symbol]);
  if (!rows[0]) return null;
  return { symbol: rows[0].symbol, coingeckoId: rows[0].coingecko_id, marketCapRank: rows[0].market_cap_rank, updatedAt: rows[0].updated_at };
}

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM coin_meta');
  return rows.map((r) => ({ symbol: r.symbol, coingeckoId: r.coingecko_id, marketCapRank: r.market_cap_rank, updatedAt: r.updated_at }));
}

module.exports = { upsert, get, getAll };
