const { pool } = require('../db/postgres');

async function list(telegramId) {
  const { rows } = await pool.query(
    'SELECT repo_name, position, pin_section FROM pinned_repos WHERE telegram_id = $1 ORDER BY pin_section NULLS FIRST, position ASC',
    [telegramId]
  );
  return rows;
}

/** Pins grouped by section for the Pinned screen — NULL section renders as
 * the default "📌 Pinned" cluster, others as their own labeled group. */
async function listGrouped(telegramId) {
  const pins = await list(telegramId);
  const groups = new Map();
  for (const p of pins) {
    const key = p.pin_section || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()].map(([section, items]) => ({ section, items }));
}

async function isPinned(telegramId, repoName) {
  const { rows } = await pool.query(
    'SELECT 1 FROM pinned_repos WHERE telegram_id = $1 AND repo_name = $2',
    [telegramId, repoName]
  );
  return rows.length > 0;
}

async function pin(telegramId, repoName, section = null) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pinned_repos WHERE telegram_id = $1',
    [telegramId]
  );
  await pool.query(
    `INSERT INTO pinned_repos (telegram_id, repo_name, position, pin_section)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id, repo_name) DO NOTHING`,
    [telegramId, repoName, rows[0].next, section]
  );
}

async function setSection(telegramId, repoName, section) {
  await pool.query(
    'UPDATE pinned_repos SET pin_section = $3 WHERE telegram_id = $1 AND repo_name = $2',
    [telegramId, repoName, section || null]
  );
}

async function listSections(telegramId) {
  const { rows } = await pool.query(
    'SELECT DISTINCT pin_section FROM pinned_repos WHERE telegram_id = $1 AND pin_section IS NOT NULL ORDER BY pin_section',
    [telegramId]
  );
  return rows.map((r) => r.pin_section);
}

async function unpin(telegramId, repoName) {
  await pool.query('DELETE FROM pinned_repos WHERE telegram_id = $1 AND repo_name = $2', [telegramId, repoName]);
}

/** Swaps the position of a pin with its immediate neighbor WITHIN THE SAME
 * SECTION (up = -1, down = +1) — reordering shouldn't jump a pin across
 * section boundaries; use setSection for that. */
async function move(telegramId, repoName, direction) {
  const all = await list(telegramId);
  const idx = all.findIndex((p) => p.repo_name === repoName);
  if (idx === -1) return;
  const section = all[idx].pin_section;
  const sameSection = all.filter((p) => p.pin_section === section);
  const localIdx = sameSection.findIndex((p) => p.repo_name === repoName);
  const swapIdx = localIdx + direction;
  if (swapIdx < 0 || swapIdx >= sameSection.length) return; // no-op at either end

  const a = sameSection[localIdx];
  const b = sameSection[swapIdx];
  await pool.query('UPDATE pinned_repos SET position = $1 WHERE telegram_id = $2 AND repo_name = $3', [b.position, telegramId, a.repo_name]);
  await pool.query('UPDATE pinned_repos SET position = $1 WHERE telegram_id = $2 AND repo_name = $3', [a.position, telegramId, b.repo_name]);
}

async function clearAll(telegramId) {
  await pool.query('DELETE FROM pinned_repos WHERE telegram_id = $1', [telegramId]);
}

async function removeByRepoName(telegramId, repoName) {
  await unpin(telegramId, repoName);
}

/** Staleness nudge data: pinned repos whose GitHub updated_at is older than
 * `days`. Pure computation from data the caller already has (Pinned screen
 * already fetches repo metadata to render cards) — deliberately never
 * auto-unpins, since a pin is an intentional signal the bot shouldn't
 * override; the screen just surfaces a "still pin-worthy?" hint. */
function findStale(pinnedRepoObjects, days = 60) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return pinnedRepoObjects.filter((r) => new Date(r.updated_at).getTime() < cutoff);
}

module.exports = {
  list, listGrouped, isPinned, pin, unpin, move, clearAll, removeByRepoName,
  setSection, listSections, findStale,
};
