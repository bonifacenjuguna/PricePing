const { pool } = require('./postgres');

async function addChannel(chatId, title, addedBy, chatHandle) {
  const { rows } = await pool.query(
    `INSERT INTO channels (chat_id, title, added_by, chat_handle)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id) DO UPDATE SET title = $2, is_active = true, chat_handle = $4
     RETURNING *`,
    [chatId, title, addedBy, chatHandle || null]
  );
  return rows[0];
}

async function removeChannel(chatId) {
  await pool.query('UPDATE channels SET is_active = false WHERE chat_id = $1', [chatId]);
}

async function getActiveChannels() {
  const { rows } = await pool.query('SELECT * FROM channels WHERE is_active = true');
  return rows;
}

async function getById(id) {
  const { rows } = await pool.query('SELECT * FROM channels WHERE id = $1', [id]);
  return rows[0] || null;
}

async function setDigestMode(id, enabled, intervalMinutes) {
  await pool.query('UPDATE channels SET digest_mode = $1, digest_interval_minutes = COALESCE($2, digest_interval_minutes) WHERE id = $3', [enabled, intervalMinutes, id]);
}

async function setQuietHours(id, start, end) {
  await pool.query('UPDATE channels SET quiet_hours_start = $1, quiet_hours_end = $2 WHERE id = $3', [start, end, id]);
}

async function setTimezone(id, tz) {
  await pool.query('UPDATE channels SET timezone = $1 WHERE id = $2', [tz, id]);
}

module.exports = { addChannel, removeChannel, getActiveChannels, getById, setDigestMode, setQuietHours, setTimezone };
