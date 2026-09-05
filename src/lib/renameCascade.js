const { pool } = require('../db/postgres');
const logger = require('./logger');

/**
 * Keeps every repo_name-keyed table (tags, pins, path memory,
 * notification mutes, webhooks, recently-viewed) bound to a repo through a
 * rename — GitHub itself redirects the old URL, but nothing on this side
 * follows automatically otherwise. Without this, a renamed repo would
 * silently lose its tags, pin position, upload path memory, mute state,
 * and live webhook registration, with no error and no visible sign
 * anything was wrong until one of those features quietly stopped working.
 *
 * Run in a single transaction: either every table follows the rename, or
 * none do (a partial cascade — e.g. tags moved but webhooks didn't — would
 * be worse than doing nothing, since it's silently inconsistent).
 *
 * repo_tags has a UNIQUE (telegram_id, repo_name, tag_id) constraint —
 * if the new name somehow already has an identical tag assignment (only
 * possible if a repo was deleted and recreated under a name that used to
 * hold the same tag), ON CONFLICT DO NOTHING keeps this from throwing.
 */
async function cascadeRename(telegramId, oldName, newName) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE repo_tags SET repo_name = $3
       WHERE telegram_id = $1 AND repo_name = $2
         AND NOT EXISTS (
           SELECT 1 FROM repo_tags rt2
           WHERE rt2.telegram_id = $1 AND rt2.repo_name = $3 AND rt2.tag_id = repo_tags.tag_id
         )`,
      [telegramId, oldName, newName]
    );
    // Any leftover rows for oldName are true duplicates against the new
    // name (same tag already applied there) — safe to drop, nothing lost.
    await client.query('DELETE FROM repo_tags WHERE telegram_id = $1 AND repo_name = $2', [telegramId, oldName]);

    await client.query(
      `UPDATE pinned_repos SET repo_name = $3 WHERE telegram_id = $1 AND repo_name = $2
       AND NOT EXISTS (SELECT 1 FROM pinned_repos p2 WHERE p2.telegram_id = $1 AND p2.repo_name = $3)`,
      [telegramId, oldName, newName]
    );

    await client.query(
      `UPDATE repo_path_memory SET repo_name = $3 WHERE telegram_id = $1 AND repo_name = $2
       AND NOT EXISTS (SELECT 1 FROM repo_path_memory m2 WHERE m2.telegram_id = $1 AND m2.repo_name = $3)`,
      [telegramId, oldName, newName]
    );

    await client.query(
      `UPDATE notification_mutes SET repo_name = $3 WHERE telegram_id = $1 AND repo_name = $2
       AND NOT EXISTS (SELECT 1 FROM notification_mutes n2 WHERE n2.telegram_id = $1 AND n2.repo_name = $3)`,
      [telegramId, oldName, newName]
    );

    await client.query(
      `UPDATE repo_webhooks SET repo_name = $3 WHERE telegram_id = $1 AND repo_name = $2
       AND NOT EXISTS (SELECT 1 FROM repo_webhooks w2 WHERE w2.telegram_id = $1 AND w2.repo_name = $3)`,
      [telegramId, oldName, newName]
    );

    await client.query(
      'UPDATE recently_viewed SET repo_name = $3 WHERE telegram_id = $1 AND repo_name = $2',
      [telegramId, oldName, newName]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Rename cascade failed — rolled back, GitHub-side rename already succeeded', {
      telegramId, oldName, newName, message: err.message,
    });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { cascadeRename };
