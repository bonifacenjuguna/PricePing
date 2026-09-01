const { pool } = require('./pool');

// Freeform coin tags — see migrations/008_v0_7_3.sql. Tag names are
// normalized to lowercase so "DeFi" and "defi" are the same group.
async function add(symbol, tag) {
  await pool.query('INSERT INTO coin_tags (symbol, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    symbol,
    tag.toLowerCase(),
  ]);
}

async function remove(symbol, tag) {
  await pool.query('DELETE FROM coin_tags WHERE symbol = $1 AND tag = $2', [symbol, tag.toLowerCase()]);
}

async function getForSymbol(symbol) {
  const { rows } = await pool.query('SELECT tag FROM coin_tags WHERE symbol = $1 ORDER BY tag', [symbol]);
  return rows.map((r) => r.tag);
}

async function getSymbolsForTag(tag) {
  const { rows } = await pool.query('SELECT symbol FROM coin_tags WHERE tag = $1 ORDER BY symbol', [
    tag.toLowerCase(),
  ]);
  return rows.map((r) => r.symbol);
}

// { tag, coinCount }[], ordered alphabetically — powers /tags and the
// bulk-action scope picker.
async function allTags() {
  const { rows } = await pool.query(
    'SELECT tag, COUNT(*)::int AS coin_count FROM coin_tags GROUP BY tag ORDER BY tag'
  );
  return rows.map((r) => ({ tag: r.tag, coinCount: r.coin_count }));
}

module.exports = { add, remove, getForSymbol, getSymbolsForTag, allTags };
