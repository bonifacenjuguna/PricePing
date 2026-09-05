const { pool } = require('../db/postgres');

async function get(telegramId, repoName) {
  const { rows } = await pool.query(
    'SELECT webhook_id, secret FROM repo_webhooks WHERE telegram_id = $1 AND repo_name = $2',
    [telegramId, repoName]
  );
  return rows[0] || null;
}

/** Every webhook registration for a user — used on Disconnect, so every
 * live webhook can be torn down on GitHub's side before the token that
 * would let us do that is wiped. */
async function getAllForUser(telegramId) {
  const { rows } = await pool.query(
    'SELECT repo_name, webhook_id FROM repo_webhooks WHERE telegram_id = $1',
    [telegramId]
  );
  return rows;
}

async function save(telegramId, repoName, webhookId, secret) {
  await pool.query(
    `INSERT INTO repo_webhooks (telegram_id, repo_name, webhook_id, secret, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (telegram_id, repo_name) DO UPDATE SET webhook_id = $3, secret = $4, created_at = now()`,
    [telegramId, repoName, webhookId, secret]
  );
}

async function remove(telegramId, repoName) {
  await pool.query('DELETE FROM repo_webhooks WHERE telegram_id = $1 AND repo_name = $2', [telegramId, repoName]);
}

/** Clears every webhook DB row for a user in one shot — used on Disconnect
 * after each webhook has already been torn down on GitHub's side. */
async function removeAllForUser(telegramId) {
  await pool.query('DELETE FROM repo_webhooks WHERE telegram_id = $1', [telegramId]);
}

/** Looks up the (telegram_id, secret) registered for a repo, so the caller
 * can verify an inbound payload's HMAC signature using the STORED secret —
 * never trust a secret the payload itself claims to have. This bot is
 * single-owner (see config.OWNER_ID), so in practice this only ever
 * resolves to one telegram_id, but keying by repo_name keeps the lookup
 * unambiguous regardless. */
async function getByRepo(repoName) {
  const { rows } = await pool.query(
    'SELECT telegram_id, secret FROM repo_webhooks WHERE repo_name = $1',
    [repoName]
  );
  return rows[0] || null;
}

module.exports = { get, getAllForUser, save, remove, removeAllForUser, getByRepo };
