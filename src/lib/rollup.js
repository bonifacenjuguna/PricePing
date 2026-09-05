const { pool } = require('../db/postgres');

/**
 * Composes a rollup summary from activity_log for the given lookback
 * window — "3 repos updated, 12 commits via bot, 2 new stars" style. Pulls
 * from data that's already being logged everywhere else in the bot (no
 * new tracking needed): repo-touching activity entries plus webhook-driven
 * 🔔 entries already written by server/app.js's digest flow.
 */
async function compose(telegramId, days) {
  const { rows } = await pool.query(
    `SELECT icon, summary, detail, created_at FROM activity_log
     WHERE telegram_id = $1 AND created_at > now() - interval '1 day' * $2 AND is_error = false`,
    [telegramId, days]
  );
  if (rows.length === 0) return null;

  const commitCount = rows.filter((r) => r.icon === '📤' || r.icon === '✏️').length;
  const pushEvents = rows.filter((r) => r.icon === '🔔' && /push/i.test(r.summary || '')).length;
  const newRepos = rows.filter((r) => r.icon === '➕').length;
  const uniqueRepos = new Set(
    rows.map((r) => (r.summary || '').match(/→\s*(\S+)$/)).filter(Boolean).map((m) => m[1])
  ).size;

  const parts = [];
  if (uniqueRepos > 0) parts.push(`${uniqueRepos} repo${uniqueRepos === 1 ? '' : 's'} touched`);
  if (commitCount > 0) parts.push(`${commitCount} change${commitCount === 1 ? '' : 's'} via bot`);
  if (pushEvents > 0) parts.push(`${pushEvents} push${pushEvents === 1 ? '' : 'es'} received`);
  if (newRepos > 0) parts.push(`${newRepos} new repo${newRepos === 1 ? '' : 's'}`);

  if (parts.length === 0) return null;
  const label = days === 1 ? 'Today' : days <= 7 ? 'This week' : `Last ${days} days`;
  return `📋 *${label}:* ${parts.join(', ')}`;
}

module.exports = { compose };
