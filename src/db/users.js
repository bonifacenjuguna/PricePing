const { pool } = require('./postgres');

async function getOrCreate(telegramId, username) {
  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id, username)
     VALUES ($1, $2)
     ON CONFLICT (telegram_id) DO UPDATE SET username = COALESCE($2, users.username)
     RETURNING *`,
    [telegramId, username || null]
  );
  return rows[0];
}

async function setTimezone(telegramId, tz) {
  await pool.query('UPDATE users SET timezone = $1, updated_at = now() WHERE telegram_id = $2', [tz, telegramId]);
}

async function setTimeFormat(telegramId, fmt) {
  await pool.query('UPDATE users SET time_format = $1, updated_at = now() WHERE telegram_id = $2', [fmt, telegramId]);
}

async function setCardStyle(telegramId, style) {
  await pool.query('UPDATE users SET card_style = $1, updated_at = now() WHERE telegram_id = $2', [style, telegramId]);
}

module.exports = { getOrCreate, setTimezone, setTimeFormat, setCardStyle };
