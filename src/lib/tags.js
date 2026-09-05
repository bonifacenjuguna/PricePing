const { pool } = require('../db/postgres');
const ruleEngine = require('./ruleEngine');

// Fixed small palette for tag chip rendering — deliberately not free-form
// hex, so chips stay visually consistent with the rest of the bot's
// outcome-based color system (see design principles in README).
const COLOR_CLASSES = ['default', 'blue', 'green', 'red', 'purple', 'orange'];

async function listTags(telegramId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.emoji, t.parent_id, t.color_class, t.auto_rule_json,
            COUNT(rt.id)::int AS repo_count
     FROM tags t
     LEFT JOIN repo_tags rt ON rt.tag_id = t.id AND rt.telegram_id = t.telegram_id
     WHERE t.telegram_id = $1
     GROUP BY t.id
     ORDER BY t.name ASC`,
    [telegramId]
  );
  return rows;
}

/** Tags as a parent -> children tree, for nested-tag menus. Top-level tags
 * (parent_id NULL) at the root; each carries a `children` array. A repo
 * filtered by a parent tag should also match anything tagged with any of
 * its descendants — see reposWithTag's `includeDescendants` option. */
async function listTagsTree(telegramId) {
  const flat = await listTags(telegramId);
  const byId = new Map(flat.map((t) => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const t of byId.values()) {
    if (t.parent_id && byId.has(t.parent_id)) byId.get(t.parent_id).children.push(t);
    else roots.push(t);
  }
  return roots;
}

async function createTag(telegramId, name, emoji, { parentId = null, colorClass = 'default' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO tags (telegram_id, name, emoji, parent_id, color_class) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_id, name) DO UPDATE SET emoji = $3, parent_id = $4, color_class = $5
     RETURNING id, name, emoji, parent_id, color_class`,
    [telegramId, name.trim(), emoji, parentId, COLOR_CLASSES.includes(colorClass) ? colorClass : 'default']
  );
  return rows[0];
}

/** All descendant tag ids of a given tag (not including itself), via a
 * recursive CTE — nesting depth is user-created so this stays cheap. */
async function descendantTagIds(telegramId, tagId) {
  const { rows } = await pool.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM tags WHERE telegram_id = $1 AND parent_id = $2
       UNION ALL
       SELECT t.id FROM tags t JOIN descendants d ON t.parent_id = d.id WHERE t.telegram_id = $1
     )
     SELECT id FROM descendants`,
    [telegramId, tagId]
  );
  return rows.map((r) => r.id);
}

/** Evaluates every tag with an auto_rule_json against one repo's data and
 * returns the ids of tags that should apply. Matching itself lives in
 * lib/ruleEngine.js, shared with 🔕 Auto-Mute rules — same rule shape,
 * same fields (language / name / visibility / fork), same wildcard syntax.
 * Caller (myRepos refresh) is responsible for actually assigning + only
 * doing so once per repo (one-time confirmation, not silent re-tagging). */
async function evaluateAutoRules(telegramId, repo) {
  const { rows } = await pool.query(
    'SELECT id, name, emoji, auto_rule_json FROM tags WHERE telegram_id = $1 AND auto_rule_json IS NOT NULL',
    [telegramId]
  );
  const matches = [];
  for (const t of rows) {
    let rule;
    try { rule = JSON.parse(t.auto_rule_json); } catch (_) { continue; }
    if (ruleEngine.matchesRule(rule, repo)) matches.push(t);
  }
  return matches;
}

/** Human-readable one-liner for a rule object (or a null/undefined rule). */
function describeRule(rule) {
  return ruleEngine.describeRule(rule);
}

async function setAutoRule(telegramId, tagId, rule /* null clears */) {
  await pool.query('UPDATE tags SET auto_rule_json = $3 WHERE telegram_id = $1 AND id = $2', [
    telegramId, tagId, rule ? JSON.stringify(rule) : null,
  ]);
}

/** Per-tag default overrides. Resolution order (see lib/defaults.js
 * resolveForRepo): repo's tag override -> global user default. */
async function getTagDefaults(tagIds) {
  if (!tagIds || tagIds.length === 0) return {};
  const { rows } = await pool.query(
    'SELECT tag_id, key, value FROM tag_defaults WHERE tag_id = ANY($1::bigint[])',
    [tagIds]
  );
  const map = {};
  for (const r of rows) {
    map[r.key] = map[r.key] || [];
    map[r.key].push({ tagId: r.tag_id, value: r.value });
  }
  return map;
}

async function setTagDefault(tagId, key, value) {
  await pool.query(
    `INSERT INTO tag_defaults (tag_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (tag_id, key) DO UPDATE SET value = $3`,
    [tagId, key, value]
  );
}

async function clearTagDefault(tagId, key) {
  await pool.query('DELETE FROM tag_defaults WHERE tag_id = $1 AND key = $2', [tagId, key]);
}

async function deleteTag(telegramId, tagId) {
  await pool.query('DELETE FROM tags WHERE telegram_id = $1 AND id = $2', [telegramId, tagId]);
}

async function tagsForRepo(telegramId, repoName) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.emoji FROM repo_tags rt
     JOIN tags t ON t.id = rt.tag_id
     WHERE rt.telegram_id = $1 AND rt.repo_name = $2
     ORDER BY t.name ASC`,
    [telegramId, repoName]
  );
  return rows;
}

async function assignTag(telegramId, repoName, tagId) {
  await pool.query(
    `INSERT INTO repo_tags (telegram_id, repo_name, tag_id) VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id, repo_name, tag_id) DO NOTHING`,
    [telegramId, repoName, tagId]
  );
}

async function removeTagFromRepo(telegramId, repoName, tagId) {
  await pool.query(
    'DELETE FROM repo_tags WHERE telegram_id = $1 AND repo_name = $2 AND tag_id = $3',
    [telegramId, repoName, tagId]
  );
}

async function reposWithTag(telegramId, tagId, { includeDescendants = true } = {}) {
  let tagIds = [Number(tagId)];
  if (includeDescendants) {
    tagIds = tagIds.concat(await descendantTagIds(telegramId, tagId));
  }
  const { rows } = await pool.query(
    'SELECT DISTINCT repo_name FROM repo_tags WHERE telegram_id = $1 AND tag_id = ANY($2::bigint[])',
    [telegramId, tagIds]
  );
  return rows.map((r) => r.repo_name);
}

/** Bulk fetch: { repoName: [{id,name,emoji}, ...] } for a set of repos in one query */
async function tagsForRepos(telegramId, repoNames) {
  if (repoNames.length === 0) return {};
  const { rows } = await pool.query(
    `SELECT rt.repo_name, t.id, t.name, t.emoji FROM repo_tags rt
     JOIN tags t ON t.id = rt.tag_id
     WHERE rt.telegram_id = $1 AND rt.repo_name = ANY($2::text[])`,
    [telegramId, repoNames]
  );
  const map = {};
  for (const row of rows) {
    if (!map[row.repo_name]) map[row.repo_name] = [];
    map[row.repo_name].push({ id: row.id, name: row.name, emoji: row.emoji });
  }
  return map;
}

/** Cleanup hook for Storage & Data's auto-cleanup-on-delete setting */
async function removeAllForRepo(telegramId, repoName) {
  await pool.query('DELETE FROM repo_tags WHERE telegram_id = $1 AND repo_name = $2', [telegramId, repoName]);
}

module.exports = {
  listTags,
  listTagsTree,
  createTag,
  deleteTag,
  tagsForRepo,
  assignTag,
  removeTagFromRepo,
  reposWithTag,
  tagsForRepos,
  removeAllForRepo,
  descendantTagIds,
  evaluateAutoRules,
  describeRule,
  setAutoRule,
  getTagDefaults,
  setTagDefault,
  clearTagDefault,
  COLOR_CLASSES,
};
