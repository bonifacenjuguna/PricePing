const { pool } = require('../db/postgres');

/**
 * 📅 Scheduled Commits — a repo's full configuration (name, visibility,
 * description, license) collected up front through the normal Create Repo
 * wizard, but with the actual GitHub creation deferred to a future time.
 * "Committed" here in the sense the person used it: the point at which
 * the repo (and its initial commit — GitHub's auto_init) actually appears.
 */
async function create(telegramId, { name, description, visibility, license, includeReadme, scheduledFor }) {
  const { rows } = await pool.query(
    `INSERT INTO scheduled_repos (telegram_id, name, description, visibility, license, include_readme, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [telegramId, name, description || null, visibility, license || null, includeReadme !== false, scheduledFor]
  );
  return rows[0];
}

async function listPending(telegramId) {
  const { rows } = await pool.query(
    `SELECT * FROM scheduled_repos WHERE telegram_id = $1 AND status = 'pending' ORDER BY scheduled_for ASC`,
    [telegramId]
  );
  return rows;
}

async function get(telegramId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM scheduled_repos WHERE telegram_id = $1 AND id = $2`,
    [telegramId, id]
  );
  return rows[0] || null;
}

async function cancel(telegramId, id) {
  await pool.query(
    `UPDATE scheduled_repos SET status = 'cancelled' WHERE telegram_id = $1 AND id = $2 AND status = 'pending'`,
    [telegramId, id]
  );
}

/** Everything due right now, across every user — polled every few minutes
 * by index.js. A schedule implies some timing precision the hourly
 * automation scheduler doesn't give, so this runs on its own faster loop. */
async function getDue() {
  const { rows } = await pool.query(`SELECT * FROM scheduled_repos WHERE status = 'pending' AND scheduled_for <= now()`);
  return rows;
}

async function markCompleted(id) {
  await pool.query(`UPDATE scheduled_repos SET status = 'completed' WHERE id = $1`, [id]);
}

async function markFailed(id, errorMessage) {
  await pool.query(`UPDATE scheduled_repos SET status = 'failed', error_message = $2 WHERE id = $1`, [id, errorMessage]);
}

module.exports = { create, listPending, get, cancel, getDue, markCompleted, markFailed };
