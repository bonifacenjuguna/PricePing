const { pool } = require('./pool');

function mapRow(r) {
  return {
    id: r.id,
    kind: r.kind,
    symbol: r.symbol,
    period: r.period,
    channelName: r.channel_name,
    cadence: r.cadence,
    atMinuteUtc: r.at_minute_utc,
    atHourUtc: r.at_hour_utc,
    dayOfWeek: r.day_of_week,
    lastRunKey: r.last_run_key,
    enabled: r.enabled,
  };
}

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM schedules ORDER BY id ASC');
  return rows.map(mapRow);
}

async function getEnabled() {
  const { rows } = await pool.query('SELECT * FROM schedules WHERE enabled = true ORDER BY id ASC');
  return rows.map(mapRow);
}

async function add({ kind, symbol, period, channelName, cadence, atMinuteUtc, atHourUtc, dayOfWeek }) {
  const { rows } = await pool.query(
    `INSERT INTO schedules (kind, symbol, period, channel_name, cadence, at_minute_utc, at_hour_utc, day_of_week)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [kind, symbol, period || null, channelName, cadence, atMinuteUtc || 0, atHourUtc ?? null, dayOfWeek ?? null]
  );
  return rows[0].id;
}

async function remove(id) {
  await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
}

async function setEnabled(id, enabled) {
  await pool.query('UPDATE schedules SET enabled = $2 WHERE id = $1', [id, enabled]);
}

async function markRun(id, runKey) {
  await pool.query('UPDATE schedules SET last_run_key = $2 WHERE id = $1', [id, runKey]);
}

module.exports = { getAll, getEnabled, add, remove, setEnabled, markRun };
