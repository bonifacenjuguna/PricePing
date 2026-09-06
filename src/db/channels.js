const { pool } = require('./pool');

async function getAll() {
  const { rows } = await pool.query('SELECT name, chat_id, is_default FROM channels ORDER BY added_at ASC');
  return rows.map((r) => ({ name: r.name, chatId: r.chat_id, isDefault: r.is_default }));
}

async function get(name) {
  const { rows } = await pool.query('SELECT name, chat_id, is_default FROM channels WHERE name = $1', [name]);
  if (!rows.length) return null;
  return { name: rows[0].name, chatId: rows[0].chat_id, isDefault: rows[0].is_default };
}

async function getDefault() {
  const { rows } = await pool.query('SELECT name, chat_id, is_default FROM channels WHERE is_default = true LIMIT 1');
  if (!rows.length) return null;
  return { name: rows[0].name, chatId: rows[0].chat_id, isDefault: true };
}

async function add(name, chatId) {
  await pool.query(
    `INSERT INTO channels (name, chat_id, is_default) VALUES ($1, $2, false)
     ON CONFLICT (name) DO UPDATE SET chat_id = $2`,
    [name, chatId]
  );
}

async function remove(name) {
  await pool.query('DELETE FROM channels WHERE name = $1', [name]);
}

// Only one channel may be default at a time — used as the implicit target
// for automatic threshold/milestone alerts and for any command where no
// channel is specified.
async function setDefault(name) {
  await pool.query('UPDATE channels SET is_default = false');
  await pool.query('UPDATE channels SET is_default = true WHERE name = $1', [name]);
}

// Resolves a channel by name, or the default channel if name is falsy.
// Returns null if nothing matches (caller should treat that as "tell the
// admin no such channel / no default configured").
async function resolve(name) {
  if (name) return get(name);
  return getDefault();
}

// Per-alert-type default (e.g. milestones -> one channel, everything else
// -> another). Falls back to the overall default if no type-specific one
// is set. alertType: 'threshold' | 'milestone' | 'manual' | 'chart' | 'digest'.
async function resolveForType(alertType) {
  const { rows } = await pool.query(
    `SELECT c.name, c.chat_id, c.is_default
     FROM default_channels_by_type d
     JOIN channels c ON c.name = d.channel_name
     WHERE d.alert_type = $1`,
    [alertType]
  );
  if (rows.length) return { name: rows[0].name, chatId: rows[0].chat_id, isDefault: rows[0].is_default };
  return getDefault();
}

async function getDefaultsByType() {
  const { rows } = await pool.query('SELECT alert_type, channel_name FROM default_channels_by_type');
  const map = {};
  for (const row of rows) map[row.alert_type] = row.channel_name;
  return map;
}

async function setDefaultForType(alertType, channelName) {
  await pool.query(
    `INSERT INTO default_channels_by_type (alert_type, channel_name) VALUES ($1, $2)
     ON CONFLICT (alert_type) DO UPDATE SET channel_name = $2`,
    [alertType, channelName]
  );
}

async function clearDefaultForType(alertType) {
  await pool.query('DELETE FROM default_channels_by_type WHERE alert_type = $1', [alertType]);
}

module.exports = {
  getAll,
  get,
  getDefault,
  add,
  remove,
  setDefault,
  resolve,
  resolveForType,
  getDefaultsByType,
  setDefaultForType,
  clearDefaultForType,
};
