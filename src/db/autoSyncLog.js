const { pool } = require('./pool');

// Records the outcome of one auto-sync pass (manual /syncnow or the
// periodic job in services/coinSync.js). added/removed are arrays of
// symbols — stored comma-joined since this is a display log, not
// something ever queried per-symbol.
async function record({ added = [], removed = [], candidatesSeen = 0, error = null }) {
  await pool.query(
    `INSERT INTO autosync_runs (added, removed, candidates_seen, error)
     VALUES ($1, $2, $3, $4)`,
    [added.length ? added.join(',') : null, removed.length ? removed.join(',') : null, candidatesSeen, error]
  );
}

async function recent(limit = 10) {
  const { rows } = await pool.query(
    'SELECT added, removed, candidates_seen, error, run_at FROM autosync_runs ORDER BY run_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = { record, recent };
