const { pool } = require('../db/postgres');

async function getDefaults(telegramId) {
  const { rows } = await pool.query(
    `SELECT default_visibility, default_commit_message, default_upload_path,
            default_sort, default_filter, auto_suggest_defaults, trash_retention_days
     FROM users WHERE telegram_id = $1`,
    [telegramId]
  );
  return rows[0] || null;
}

const ALLOWED_FIELDS = new Set([
  'default_visibility', 'default_commit_message', 'default_upload_path',
  'default_sort', 'default_filter', 'auto_suggest_defaults', 'trash_retention_days',
]);

/**
 * Sets a default AND logs the change to defaults_changelog (old -> new),
 * so "why did my upload path change" is always answerable from Activity
 * instead of being a mystery. `source` distinguishes a manual Settings
 * edit from an accepted learned-suggestion, since those read differently
 * in the audit trail.
 */
async function setDefault(telegramId, field, value, { source = 'manual' } = {}) {
  if (!ALLOWED_FIELDS.has(field)) throw new Error(`Unknown default field: ${field}`);
  const before = await getDefaults(telegramId);
  const oldValue = before ? before[field] : null;
  await pool.query(`UPDATE users SET ${field} = $1 WHERE telegram_id = $2`, [value, telegramId]);
  if (String(oldValue) !== String(value)) {
    await pool.query(
      `INSERT INTO defaults_changelog (telegram_id, field, old_value, new_value, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [telegramId, field, oldValue == null ? null : String(oldValue), String(value), source]
    );
  }
}

async function getChangelog(telegramId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT field, old_value, new_value, source, changed_at FROM defaults_changelog
     WHERE telegram_id = $1 ORDER BY changed_at DESC LIMIT $2`,
    [telegramId, limit]
  );
  return rows;
}

/**
 * "Learn from me" check — looks at the last 3 activity_log entries recording
 * a repo-creation visibility choice and, if all 3 agree and disagree with
 * the current default, returns the suggested value. Returns null if there's
 * no clear pattern yet, or the pattern already matches the current default.
 */
async function checkVisibilityPattern(telegramId) {
  const { rows } = await pool.query(
    `SELECT detail FROM activity_log
     WHERE telegram_id = $1 AND icon = '➕' AND detail LIKE 'visibility:%'
     ORDER BY created_at DESC LIMIT 3`,
    [telegramId]
  );
  if (rows.length < 3) return null;

  const choices = rows.map((r) => r.detail.replace('visibility:', ''));
  const allSame = choices.every((c) => c === choices[0]);
  if (!allSame) return null;

  const defaults = await getDefaults(telegramId);
  if (!defaults || !defaults.auto_suggest_defaults) return null;
  if (defaults.default_visibility === choices[0]) return null; // already matches

  return choices[0]; // 'private' or 'public'
}

/**
 * Learned upload-path suggestion — the global counterpart to per-repo
 * pathMemory. Looks at upload_path_frequency (bumped by
 * pathMemory.setLastPath's caller on every successful upload — see
 * lib/pathMemory.js) and, if one path clearly dominates and differs from
 * the current default, returns it as a suggestion. Never applied silently;
 * callers present it as a one-tap confirm, same UX as checkVisibilityPattern.
 */
async function checkUploadPathPattern(telegramId) {
  const defaults = await getDefaults(telegramId);
  if (!defaults || !defaults.auto_suggest_defaults) return null;

  const { rows } = await pool.query(
    `SELECT path, count FROM upload_path_frequency
     WHERE telegram_id = $1 ORDER BY count DESC, last_used_at DESC LIMIT 1`,
    [telegramId]
  );
  if (!rows[0] || rows[0].count < 5) return null; // needs a real pattern, not one lucky repeat
  if (rows[0].path === defaults.default_upload_path) return null;
  return rows[0].path;
}

async function bumpUploadPathFrequency(telegramId, path) {
  if (!path) return; // root uploads aren't a "path preference" worth counting
  await pool.query(
    `INSERT INTO upload_path_frequency (telegram_id, path, count, last_used_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (telegram_id, path) DO UPDATE SET count = upload_path_frequency.count + 1, last_used_at = now()`,
    [telegramId, path]
  );
}

/**
 * Placeholder expansion for default_commit_message templates.
 * Supported: {filename}, {repo}, {date} (YYYY-MM-DD), {count} (file count).
 * Unrecognized placeholders are left as-is rather than stripped, so a typo
 * is visible in the resulting commit message instead of silently vanishing.
 */
function expandCommitTemplate(template, { filename = '', repo = '', count = 1 } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  return template
    .replace(/\{filename\}/g, filename)
    .replace(/\{repo\}/g, repo)
    .replace(/\{date\}/g, date)
    .replace(/\{count\}/g, String(count));
}

/**
 * Resolves the effective default for one field, applying per-tag overrides
 * (lib/tags.getTagDefaults) on top of the global user default. Resolution
 * order: first tag (by id ascending) carrying an override for `key` wins —
 * deliberately simple (no priority system) since multi-tag conflicts are
 * expected to be rare and a user can always remove a tag's override.
 */
async function resolveForRepo(telegramId, key, tagIds) {
  const globalDefaults = await getDefaults(telegramId);
  const globalValue = globalDefaults ? globalDefaults[key] : null;
  if (!tagIds || tagIds.length === 0) return globalValue;

  const tags = require('./tags');
  const tagDefaultsMap = await tags.getTagDefaults(tagIds);
  const overrides = tagDefaultsMap[key];
  if (overrides && overrides.length > 0) return overrides[0].value;
  return globalValue;
}

module.exports = {
  getDefaults, setDefault, getChangelog, checkVisibilityPattern,
  checkUploadPathPattern, bumpUploadPathFrequency, expandCommitTemplate, resolveForRepo,
};
