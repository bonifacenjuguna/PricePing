const { pool } = require('./pool');

async function record(symbol, price, changeUsd, direction) {
  await pool.query(
    `INSERT INTO alerts_log (symbol, price, change_usd, direction)
     VALUES ($1, $2, $3, $4)`,
    [symbol, price, changeUsd, direction]
  );
}

async function countToday() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM alerts_log WHERE created_at >= date_trunc('day', now())`
  );
  return rows[0].count;
}

async function countAllTime() {
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM alerts_log');
  return rows[0].count;
}

async function countPerCoin() {
  const { rows } = await pool.query(
    `SELECT symbol, count(*)::int AS count, max(created_at) AS last_alert_at
     FROM alerts_log
     GROUP BY symbol
     ORDER BY count DESC`
  );
  return rows;
}

async function recent(limit = 10) {
  const { rows } = await pool.query(
    `SELECT symbol, price, change_usd, direction, created_at
     FROM alerts_log ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = { record, countToday, countAllTime, countPerCoin, recent };
