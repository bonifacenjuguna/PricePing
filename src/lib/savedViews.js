const { pool } = require('../db/postgres');
const filterClauses = require('./filterClauses');

async function list(telegramId) {
  const { rows } = await pool.query(
    'SELECT id, name, filter_json, position FROM saved_views WHERE telegram_id = $1 ORDER BY position ASC, id ASC',
    [telegramId]
  );
  return rows.map((r) => ({ ...r, clauses: JSON.parse(r.filter_json) }));
}

async function get(telegramId, viewId) {
  const { rows } = await pool.query(
    'SELECT id, name, filter_json FROM saved_views WHERE telegram_id = $1 AND id = $2',
    [telegramId, viewId]
  );
  if (!rows[0]) return null;
  return { ...rows[0], clauses: JSON.parse(rows[0].filter_json) };
}

async function create(telegramId, name, clauses) {
  const { rows: posRows } = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM saved_views WHERE telegram_id = $1',
    [telegramId]
  );
  const { rows } = await pool.query(
    `INSERT INTO saved_views (telegram_id, name, filter_json, position) VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id, name) DO UPDATE SET filter_json = $3
     RETURNING id, name, filter_json, position`,
    [telegramId, name.trim(), JSON.stringify(clauses), posRows[0].next]
  );
  return rows[0];
}

async function remove(telegramId, viewId) {
  await pool.query('DELETE FROM saved_views WHERE telegram_id = $1 AND id = $2', [telegramId, viewId]);
}

/** Runs a saved view's stored clauses against an already-fetched repo list
 * (same repoCache.getRepos data every other list screen uses — no separate
 * fetch path). */
async function apply(telegramId, view, repos) {
  const ctx = await filterClauses.buildTagContext(telegramId, view.clauses);
  return filterClauses.applyClauses(repos, view.clauses, ctx);
}

module.exports = { list, get, create, remove, apply };
