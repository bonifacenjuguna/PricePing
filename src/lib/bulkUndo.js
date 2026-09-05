const { pool } = require('../db/postgres');

// Delete and rename are permanent/collision-prone on GitHub's side — never
// logged here. Only actions where "previous state" is a simple value we
// can write straight back are eligible.
const REVERSIBLE_ACTIONS = new Set(['private', 'public', 'tag', 'archive', 'unarchive', 'pin', 'unpin']);
const TTL_MS = 60 * 60 * 1000; // 1 hour

function isReversible(actionType) {
  return REVERSIBLE_ACTIONS.has(actionType);
}

/**
 * Records one bulk operation for undo. `previousStateByRepo` is
 * `{ repoName: <value before the change> }` — e.g. for a visibility bulk
 * action, the prior `private` boolean per repo (since not every repo in
 * the batch was necessarily the same visibility beforehand).
 */
async function record(telegramId, actionType, repoNames, previousStateByRepo) {
  if (!isReversible(actionType)) return null;
  const { rows } = await pool.query(
    `INSERT INTO bulk_action_log (telegram_id, action_type, repo_names, previous_state, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '1 hour')
     RETURNING id`,
    [telegramId, actionType, JSON.stringify(repoNames), JSON.stringify(previousStateByRepo)]
  );
  return rows[0].id;
}

async function getUndoable(telegramId, logId) {
  const { rows } = await pool.query(
    `SELECT id, action_type, repo_names, previous_state, created_at, expires_at, undone_at
     FROM bulk_action_log WHERE telegram_id = $1 AND id = $2`,
    [telegramId, logId]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  if (row.undone_at) return { ...row, status: 'already-undone' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ...row, status: 'expired' };
  return {
    ...row,
    status: 'ok',
    repoNames: JSON.parse(row.repo_names),
    previousState: JSON.parse(row.previous_state),
  };
}

async function markUndone(logId) {
  await pool.query('UPDATE bulk_action_log SET undone_at = now() WHERE id = $1', [logId]);
}

/** Most recent undoable entry for the "Undo last bulk action" quick button. */
async function getMostRecent(telegramId) {
  const { rows } = await pool.query(
    `SELECT id, action_type, repo_names, created_at FROM bulk_action_log
     WHERE telegram_id = $1 AND undone_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [telegramId]
  );
  return rows[0] || null;
}

module.exports = { isReversible, record, getUndoable, markUndone, getMostRecent, REVERSIBLE_ACTIONS, TTL_MS };
