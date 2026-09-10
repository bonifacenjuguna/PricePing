const { pool } = require('./postgres');

async function getAllForChannel(channelId) {
  const { rows } = await pool.query('SELECT * FROM coin_state WHERE channel_id = $1', [channelId]);
  const map = new Map();
  for (const r of rows) {
    map.set(r.symbol, {
      lastPrice: r.last_price !== null ? Number(r.last_price) : null,
      lastAlertPrice: r.last_alert_price !== null ? Number(r.last_alert_price) : null,
      lastAlertAt: r.last_alert_at,
      lastMilestone: r.last_milestone !== null ? Number(r.last_milestone) : null,
    });
  }
  return map;
}

async function updateLastPrice(channelId, symbol, price) {
  await pool.query(
    `INSERT INTO coin_state (channel_id, symbol, last_price, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (channel_id, symbol) DO UPDATE SET last_price = $3, updated_at = now()`,
    [channelId, symbol, price]
  );
}

// Seeds last_alert_price if missing (first-ever tick for this coin in this
// channel) — returns true if it just seeded (caller should skip alerting
// this tick, same as PricePing's pattern: no alert on the very first tick).
async function seedBaselineIfMissing(channelId, symbol, price) {
  const { rows } = await pool.query('SELECT last_alert_price FROM coin_state WHERE channel_id = $1 AND symbol = $2', [channelId, symbol]);
  if (rows.length && rows[0].last_alert_price !== null) return false;
  await pool.query(
    `INSERT INTO coin_state (channel_id, symbol, last_alert_price, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (channel_id, symbol) DO UPDATE SET last_alert_price = $3, updated_at = now()`,
    [channelId, symbol, price]
  );
  return true;
}

async function recordAlert(channelId, symbol, price) {
  await pool.query(
    `UPDATE coin_state SET last_alert_price = $3, last_alert_at = now() WHERE channel_id = $1 AND symbol = $2`,
    [channelId, symbol, price]
  );
}

async function setLastMilestone(channelId, symbol, level) {
  await pool.query(
    `INSERT INTO coin_state (channel_id, symbol, last_milestone, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (channel_id, symbol) DO UPDATE SET last_milestone = $3, updated_at = now()`,
    [channelId, symbol, level]
  );
}

module.exports = { getAllForChannel, updateLastPrice, seedBaselineIfMissing, recordAlert, setLastMilestone };
