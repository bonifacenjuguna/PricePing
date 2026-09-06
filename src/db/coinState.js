const { pool } = require('./pool');

async function getAll() {
  const { rows } = await pool.query(
    `SELECT symbol, last_price, last_alert_price, last_alert_at, paused_until, last_milestone
     FROM coin_state`
  );
  const map = {};
  for (const row of rows) {
    map[row.symbol] = {
      lastPrice: row.last_price === null ? null : Number(row.last_price),
      lastAlertPrice: row.last_alert_price === null ? null : Number(row.last_alert_price),
      lastAlertAt: row.last_alert_at,
      pausedUntil: row.paused_until,
      lastMilestone: row.last_milestone === null ? null : Number(row.last_milestone),
    };
  }
  return map;
}

// Updates the running "last seen" price every tick, regardless of whether
// an alert fired. Cheap upsert, keeps /prices and /status fresh.
async function updateLastPrice(symbol, price) {
  await pool.query(
    `INSERT INTO coin_state (symbol, last_price, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (symbol) DO UPDATE SET last_price = $2, updated_at = now()`,
    [symbol, price]
  );
}

// Called only after a successful channel send — this is what makes restarts
// safe (no duplicate alerts) and what the cooldown window is measured from.
// Also called by a manual /post so it doesn't get immediately followed by a
// redundant threshold alert for the same move.
async function recordAlert(symbol, price) {
  await pool.query(
    `UPDATE coin_state
     SET last_alert_price = $2, last_alert_at = now(), updated_at = now()
     WHERE symbol = $1`,
    [symbol, price]
  );
}

// First-run baseline seed: if a coin has never had last_alert_price set,
// silently record the current price as the baseline without alerting.
async function seedBaselineIfMissing(symbol, price) {
  const { rows } = await pool.query(
    'SELECT last_alert_price FROM coin_state WHERE symbol = $1',
    [symbol]
  );
  if (rows.length && rows[0].last_alert_price === null) {
    await pool.query(
      `UPDATE coin_state SET last_alert_price = $2, updated_at = now() WHERE symbol = $1`,
      [symbol, price]
    );
    return true; // was seeded this call — caller should skip alert check
  }
  return false;
}

// --- Per-coin mute (independent of the global pause) ---
async function setMuteUntil(symbol, date) {
  await pool.query(
    `INSERT INTO coin_state (symbol, paused_until, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (symbol) DO UPDATE SET paused_until = $2, updated_at = now()`,
    [symbol, date]
  );
}

async function clearMute(symbol) {
  await pool.query(
    `UPDATE coin_state SET paused_until = NULL, updated_at = now() WHERE symbol = $1`,
    [symbol]
  );
}

// --- Milestone tracking (round-number crossings) ---
async function setLastMilestone(symbol, milestoneValue) {
  await pool.query(
    `UPDATE coin_state SET last_milestone = $2, updated_at = now() WHERE symbol = $1`,
    [symbol, milestoneValue]
  );
}

module.exports = {
  getAll,
  updateLastPrice,
  recordAlert,
  seedBaselineIfMissing,
  setMuteUntil,
  clearMute,
  setLastMilestone,
};
