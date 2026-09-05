const { pool } = require('../db/postgres');

/** Returns the previous snapshot's total bytes and when it was taken, or
 * null if this is the first time Stats has ever computed a total. */
async function getPrevious(telegramId) {
  const { rows } = await pool.query(
    'SELECT total_bytes, snapshotted_at FROM size_snapshots WHERE telegram_id = $1',
    [telegramId]
  );
  return rows[0] || null;
}

/**
 * Overwrites the "latest" row (still one per user — fast lookup for the
 * single trend delta) and appends to size_snapshot_history for a
 * real rolling series. History is capped by only inserting once per
 * calendar day per user (checked here rather than via a separate cron),
 * so repeatedly opening Stats in one day doesn't flood the series with
 * near-duplicate points.
 */
async function save(telegramId, totalBytes) {
  await pool.query(
    `INSERT INTO size_snapshots (telegram_id, total_bytes, snapshotted_at)
     VALUES ($1, $2, now())
     ON CONFLICT (telegram_id) DO UPDATE SET total_bytes = $2, snapshotted_at = now()`,
    [telegramId, totalBytes]
  );

  const { rows } = await pool.query(
    `SELECT 1 FROM size_snapshot_history
     WHERE telegram_id = $1 AND snapshotted_at > now() - interval '1 day' LIMIT 1`,
    [telegramId]
  );
  if (rows.length === 0) {
    await pool.query(
      'INSERT INTO size_snapshot_history (telegram_id, total_bytes, snapshotted_at) VALUES ($1, $2, now())',
      [telegramId, totalBytes]
    );
    // Prune anything older than 90 days — a rolling window, not an archive.
    await pool.query(
      `DELETE FROM size_snapshot_history WHERE telegram_id = $1 AND snapshotted_at < now() - interval '90 days'`,
      [telegramId]
    );
  }
}

async function getHistory(telegramId, days = 30) {
  const { rows } = await pool.query(
    `SELECT total_bytes, snapshotted_at FROM size_snapshot_history
     WHERE telegram_id = $1 AND snapshotted_at > now() - interval '1 day' * $2
     ORDER BY snapshotted_at ASC`,
    [telegramId, days]
  );
  return rows;
}

/** Text-based sparkline (Telegram has no chart rendering) scaled to the
 * series' own min/max — good enough for "shape of the trend", not exact
 * values (the numeric delta line next to it already gives the precise figure). */
function sparkline(values) {
  if (values.length < 2) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v) => blocks[Math.min(blocks.length - 1, Math.floor(((v - min) / range) * (blocks.length - 1)))]).join('');
}

module.exports = { getPrevious, save, getHistory, sparkline };
