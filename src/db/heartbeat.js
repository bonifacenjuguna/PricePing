const { pool } = require('./pool');

// Touched at the end of every successful poller tick. Watched by
// heartbeatWatchdog.js — if this goes stale while the process is still
// alive (an uncaught promise rejection slipping past scheduler.js's
// try/catch would be the classic cause), the admin gets notified instead
// of alerts just silently stopping.
async function touch(tickMs) {
  await pool.query(
    `UPDATE heartbeat SET last_tick_at = now(), last_tick_ms = $1 WHERE id = 1`,
    [Math.round(tickMs)]
  );
}

async function get() {
  const { rows } = await pool.query('SELECT last_tick_at, last_tick_ms FROM heartbeat WHERE id = 1');
  if (!rows.length) return { lastTickAt: null, lastTickMs: null };
  return { lastTickAt: rows[0].last_tick_at, lastTickMs: rows[0].last_tick_ms };
}

module.exports = { touch, get };
