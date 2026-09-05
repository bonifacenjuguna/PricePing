const { pool } = require('../db/postgres');

/**
 * Rules-based anomaly detection, evaluated at write time so the
 * flag is stored once and never recomputed. Two checks, both cheap
 * (single prior-row lookup), deliberately not ML — appropriate for a
 * single-owner bot where "unusual" just means "worth a second look",
 * not a hard security verdict:
 *
 *  1. Reconnect within 5 minutes of a disconnect — could be a normal
 *     re-auth after a scope change, or could be a token that got
 *     invalidated and someone re-authorizing from somewhere unexpected.
 *  2. Scope changed between this connection and the previous one — the
 *     access level the bot has silently changed, worth surfacing even if
 *     it was the owner's own doing.
 */
async function detectAnomaly(telegramId, event, detail) {
  if (event !== 'connected' && event !== 'reconnected') return null;

  const { rows } = await pool.query(
    `SELECT event, detail, created_at FROM access_log
     WHERE telegram_id = $1 AND event IN ('connected', 'reconnected', 'disconnected')
     ORDER BY created_at DESC LIMIT 1`,
    [telegramId]
  );
  const prev = rows[0];
  if (!prev) return null;

  if (prev.event === 'disconnected') {
    const minutesSince = (Date.now() - new Date(prev.created_at).getTime()) / 60000;
    if (minutesSince <= 5) return `Reconnected ${Math.round(minutesSince)}m after disconnecting`;
  }

  const prevScope = (prev.detail || '').match(/scope:\s*(.+)/);
  const newScope = (detail || '').match(/scope:\s*(.+)/);
  if (prevScope && newScope && prevScope[1] !== newScope[1]) {
    return `Scope changed: ${prevScope[1]} → ${newScope[1]}`;
  }

  return null;
}

async function record(telegramId, event, detail = null) {
  const reason = await detectAnomaly(telegramId, event, detail).catch(() => null);
  await pool.query(
    'INSERT INTO access_log (telegram_id, event, detail, is_anomalous, anomaly_reason) VALUES ($1, $2, $3, $4, $5)',
    [telegramId, event, detail, !!reason, reason]
  );
  return reason;
}

async function recent(telegramId, limit = 10) {
  const { rows } = await pool.query(
    'SELECT event, detail, is_anomalous, anomaly_reason, created_at FROM access_log WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT $2',
    [telegramId, limit]
  );
  return rows;
}

/** Same reasoning as activity.pruneOlderThan — access_log has no other
 * cleanup path, called daily by the scheduler in index.js. */
async function pruneOlderThan(days) {
  const { rowCount } = await pool.query(
    `DELETE FROM access_log WHERE created_at < now() - ($1 || ' days')::interval`,
    [days]
  );
  return rowCount;
}

module.exports = { record, recent, detectAnomaly, pruneOlderThan };
