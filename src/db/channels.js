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

module.exports = { getAll, get, getDefault, add, remove, setDefault, resolve };
