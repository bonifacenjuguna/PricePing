const { pool } = require('./pool');

async function record(type, message) {
  try {
    await pool.query('INSERT INTO events (type, message) VALUES ($1, $2)', [type, message]);
  } catch (err) {
    // Never let event logging itself take the process down.
    // eslint-disable-next-line no-console
    console.error('Failed to record event', err.message);
  }
}

async function latest(limit = 5) {
  const { rows } = await pool.query(
    'SELECT type, message, created_at FROM events ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

// Config-change audit trail — a thin wrapper over record() with a fixed
// type so /auditlog can filter to just admin actions, not system events
// like boot/binance_outage/heartbeat_stale.
async function recordAudit(action) {
  return record('audit', action);
}

async function latestAudit(limit = 15) {
  const { rows } = await pool.query(
    `SELECT message, created_at FROM events WHERE type = 'audit' ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = { record, latest, recordAudit, latestAudit };
