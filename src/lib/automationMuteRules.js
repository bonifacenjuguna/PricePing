const { pool } = require('../db/postgres');
const ruleEngine = require('./ruleEngine');

/**
 * 🔕 Auto-Mute rules — same {field, op, value} shape as an auto-tag rule
 * (see lib/ruleEngine.js), but not tied to a tag: a repo matching an active
 * mute rule gets its Live Alert notifications muted automatically. Only
 * ever acts on repos that already have alerts enabled — a mute rule can't
 * enable webhooks on its own, it only ever turns notifications *down*.
 */
async function listMuteRules(telegramId) {
  const { rows } = await pool.query(
    'SELECT id, field, op, value FROM automation_mute_rules WHERE telegram_id = $1 ORDER BY id ASC',
    [telegramId]
  );
  return rows;
}

async function createMuteRule(telegramId, rule) {
  const { rows } = await pool.query(
    `INSERT INTO automation_mute_rules (telegram_id, field, op, value)
     VALUES ($1, $2, $3, $4) RETURNING id, field, op, value`,
    [telegramId, rule.field, rule.op, rule.value]
  );
  return rows[0];
}

async function deleteMuteRule(telegramId, ruleId) {
  await pool.query('DELETE FROM automation_mute_rules WHERE telegram_id = $1 AND id = $2', [telegramId, ruleId]);
}

/** Every active mute rule that matches this one repo (usually 0 or 1, but a
 * repo can match more than one rule at once — caller just needs to know
 * "should this be muted", not which specific rule did it). */
async function evaluateMuteRules(telegramId, repo) {
  const rules = await listMuteRules(telegramId);
  return rules.filter((r) => ruleEngine.matchesRule(r, repo));
}

module.exports = { listMuteRules, createMuteRule, deleteMuteRule, evaluateMuteRules };
