const { pool } = require('../db/postgres');
const ruleEngine = require('./ruleEngine');

/**
 * 💾 Auto-Backup rules — same {field, op, value} shape as auto-tag and
 * auto-mute rules (see lib/ruleEngine.js). A repo matching an active
 * backup rule gets a zip snapshot delivered as a Telegram document, either
 * weekly (index.js scheduler) or on demand via "▶️ Backup Now".
 */
async function listBackupRules(telegramId) {
  const { rows } = await pool.query(
    'SELECT id, field, op, value FROM automation_backup_rules WHERE telegram_id = $1 ORDER BY id ASC',
    [telegramId]
  );
  return rows;
}

async function createBackupRule(telegramId, rule) {
  const { rows } = await pool.query(
    `INSERT INTO automation_backup_rules (telegram_id, field, op, value)
     VALUES ($1, $2, $3, $4) RETURNING id, field, op, value`,
    [telegramId, rule.field, rule.op, rule.value]
  );
  return rows[0];
}

async function deleteBackupRule(telegramId, ruleId) {
  await pool.query('DELETE FROM automation_backup_rules WHERE telegram_id = $1 AND id = $2', [telegramId, ruleId]);
}

/** Every repo (out of the ones passed in) that matches at least one active
 * backup rule. Caller supplies the repo list since fetching it needs a
 * live GitHub token this module has no reason to know about. */
async function matchingRepos(telegramId, repos) {
  const rules = await listBackupRules(telegramId);
  if (rules.length === 0) return [];
  return repos.filter((repo) => rules.some((r) => ruleEngine.matchesRule(r, repo)));
}

module.exports = { listBackupRules, createBackupRule, deleteBackupRule, matchingRepos };
