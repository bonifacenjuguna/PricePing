const { pool } = require('./pool');

// alertType: 'threshold' (default, automatic), 'manual' (/post), or
// 'milestone' (round-number crossing). channelName: which registered
// channel this actually went to — defaults to 'main' for backward compat.
async function record(symbol, price, changeUsd, direction, alertType = 'threshold', channelName = 'main') {
  await pool.query(
    `INSERT INTO alerts_log (symbol, price, change_usd, direction, alert_type, channel_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [symbol, price, changeUsd, direction, alertType, channelName]
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

// Backs the hourly send cap (MAX_ALERTS_PER_HOUR) — counts channel sends in
// the trailing 60 minutes, not calendar-hour, so it's a true rolling window.
async function countLastHour() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM alerts_log WHERE created_at >= now() - interval '1 hour'`
  );
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
    `SELECT symbol, price, change_usd, direction, alert_type, created_at
     FROM alerts_log ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function recentForSymbol(symbol, limit = 10, channelName = null) {
  if (channelName) {
    const { rows } = await pool.query(
      `SELECT symbol, price, change_usd, direction, alert_type, channel_name, created_at
       FROM alerts_log WHERE symbol = $1 AND channel_name = $2 ORDER BY created_at DESC LIMIT $3`,
      [symbol, channelName, limit]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT symbol, price, change_usd, direction, alert_type, channel_name, created_at
     FROM alerts_log WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`,
    [symbol, limit]
  );
  return rows;
}

async function countTodayForSymbol(symbol) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM alerts_log
     WHERE symbol = $1 AND created_at >= date_trunc('day', now())`,
    [symbol]
  );
  return rows[0].count;
}

module.exports = {
  record,
  countToday,
  countAllTime,
  countLastHour,
  countTodayForSymbol,
  countPerCoin,
  recent,
  recentForSymbol,
};
