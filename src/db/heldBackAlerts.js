const { pool } = require('./pool');

async function record(symbol, alertType, reason) {
  await pool.query('INSERT INTO held_back_alerts (symbol, alert_type, reason) VALUES ($1, $2, $3)', [
    symbol,
    alertType,
    reason,
  ]);
}

async function recent(limit = 20) {
  const { rows } = await pool.query('SELECT * FROM held_back_alerts ORDER BY id DESC LIMIT $1', [limit]);
  return rows.map((r) => ({ id: r.id, symbol: r.symbol, alertType: r.alert_type, reason: r.reason, createdAt: r.created_at }));
}

async function countLastHour() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM held_back_alerts WHERE created_at > now() - interval '1 hour'");
  return rows[0].c;
}

async function clear() {
  await pool.query('DELETE FROM held_back_alerts');
}

module.exports = { record, recent, countLastHour, clear };
