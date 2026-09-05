const { pool } = require('../db/postgres');

const MAX_HISTORY = 5;

/** Records a search, keeping only the most recent MAX_HISTORY per user —
 * old entries beyond that are pruned so this table can't grow unbounded. */
async function record(telegramId, query) {
  const trimmed = query.trim().slice(0, 100); // sane cap on stored length
  if (!trimmed) return;
  await pool.query(
    'INSERT INTO search_history (telegram_id, query, searched_at) VALUES ($1, $2, now())',
    [telegramId, trimmed]
  );
  await pool.query(
    `DELETE FROM search_history WHERE id IN (
       SELECT id FROM search_history WHERE telegram_id = $1
       ORDER BY searched_at DESC OFFSET $2
     )`,
    [telegramId, MAX_HISTORY]
  );
}

/** Most recent distinct queries, newest first. */
async function recent(telegramId, limit = MAX_HISTORY) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (query) query, searched_at FROM search_history
     WHERE telegram_id = $1 ORDER BY query, searched_at DESC`,
    [telegramId]
  );
  return rows
    .sort((a, b) => new Date(b.searched_at) - new Date(a.searched_at))
    .slice(0, limit)
    .map((r) => r.query);
}

/** #3 — clears all stored search history for this user. */
async function clear(telegramId) {
  await pool.query('DELETE FROM search_history WHERE telegram_id = $1', [telegramId]);
}

module.exports = { record, recent, clear };
