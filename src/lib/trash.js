const { pool } = require('../db/postgres');

/**
 * 🗑️ Trash — see db/schema.sql's trashed_repos table for the storage
 * approach (the zip snapshot lives as a Telegram document in the person's
 * own chat; this table just tracks its file_id plus enough metadata to
 * restore or display it).
 */
async function add(telegramId, { originalName, description, visibility, backupFileId, retentionDays }) {
  const { rows } = await pool.query(
    `INSERT INTO trashed_repos (telegram_id, original_name, description, visibility, backup_file_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)
     RETURNING *`,
    [telegramId, originalName, description || null, visibility, backupFileId, retentionDays]
  );
  return rows[0];
}

/** Everything still recoverable — not yet restored, not yet expired. */
async function list(telegramId) {
  const { rows } = await pool.query(
    `SELECT * FROM trashed_repos
     WHERE telegram_id = $1 AND restored_at IS NULL AND expires_at > now()
     ORDER BY deleted_at DESC`,
    [telegramId]
  );
  return rows;
}

async function get(telegramId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM trashed_repos WHERE telegram_id = $1 AND id = $2`,
    [telegramId, id]
  );
  return rows[0] || null;
}

async function markRestored(telegramId, id) {
  await pool.query(
    `UPDATE trashed_repos SET restored_at = now() WHERE telegram_id = $1 AND id = $2`,
    [telegramId, id]
  );
}

/** Called daily by the automation scheduler — expired rows just get
 * dropped from the table. There's no separate cleanup needed on the
 * Telegram side; an unreferenced file_id simply stops being useful once
 * nothing in the bot points at it anymore. */
async function pruneExpired() {
  const { rowCount } = await pool.query(
    `DELETE FROM trashed_repos WHERE expires_at <= now() AND restored_at IS NULL`
  );
  return rowCount;
}

module.exports = { add, list, get, markRestored, pruneExpired };
