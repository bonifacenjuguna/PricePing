const { pool } = require('./postgres');

const ADMIN_NOTIFY_THRESHOLD = 5; // consecutive failures before we alert the admin

async function recordSuccess(source) {
  await pool.query(
    `INSERT INTO source_health (source, last_success_at, consecutive_failures, admin_notified)
     VALUES ($1, now(), 0, false)
     ON CONFLICT (source) DO UPDATE SET last_success_at = now(), consecutive_failures = 0, admin_notified = false`,
    [source]
  );
}

// Returns { shouldNotifyAdmin, consecutiveFailures }
async function recordFailure(source) {
  const { rows } = await pool.query(
    `INSERT INTO source_health (source, last_failure_at, consecutive_failures)
     VALUES ($1, now(), 1)
     ON CONFLICT (source) DO UPDATE SET last_failure_at = now(), consecutive_failures = source_health.consecutive_failures + 1
     RETURNING consecutive_failures, admin_notified`,
    [source]
  );
  const row = rows[0];
  const shouldNotify = row.consecutive_failures >= ADMIN_NOTIFY_THRESHOLD && !row.admin_notified;
  if (shouldNotify) {
    await pool.query('UPDATE source_health SET admin_notified = true WHERE source = $1', [source]);
  }
  return { shouldNotifyAdmin: shouldNotify, consecutiveFailures: row.consecutive_failures };
}

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM source_health ORDER BY source');
  return rows;
}

module.exports = { recordSuccess, recordFailure, getAll, ADMIN_NOTIFY_THRESHOLD };
