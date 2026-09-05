const { pool } = require('../db/postgres');

const MAX_HISTORY = 5;

/** Records a repo view, keeping only the most recent MAX_HISTORY per user. */
async function record(telegramId, repoName) {
  await pool.query(
    'INSERT INTO recently_viewed (telegram_id, repo_name, viewed_at) VALUES ($1, $2, now())',
    [telegramId, repoName]
  );
  await pool.query(
    `DELETE FROM recently_viewed WHERE id IN (
       SELECT id FROM recently_viewed WHERE telegram_id = $1
       ORDER BY viewed_at DESC OFFSET $2
     )`,
    [telegramId, MAX_HISTORY]
  );
}

/** Most recently viewed distinct repos, newest first. */
async function recent(telegramId, limit = MAX_HISTORY) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (repo_name) repo_name, viewed_at FROM recently_viewed
     WHERE telegram_id = $1 ORDER BY repo_name, viewed_at DESC`,
    [telegramId]
  );
  return rows
    .sort((a, b) => new Date(b.viewed_at) - new Date(a.viewed_at))
    .slice(0, limit)
    .map((r) => r.repo_name);
}

module.exports = { record, recent };
