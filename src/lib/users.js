const { pool } = require('../db/postgres');
const { encrypt, decrypt } = require('./crypto');

async function getUser(telegramId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return rows[0] || null;
}

async function isConnected(telegramId) {
  const user = await getUser(telegramId);
  return !!(user && user.github_token_enc && !user.disconnected_at);
}

async function getDecryptedToken(telegramId) {
  const user = await getUser(telegramId);
  if (!user || !user.github_token_enc) return null;
  return decrypt(user.github_token_enc);
}

/** Called by the OAuth /callback route once the token exchange succeeds */
async function saveConnection(telegramId, { accessToken, scope, githubUsername }) {
  const encToken = encrypt(accessToken);
  await pool.query(
    `INSERT INTO users (telegram_id, github_username, github_token_enc, github_scope, connected_at, disconnected_at)
     VALUES ($1, $2, $3, $4, now(), NULL)
     ON CONFLICT (telegram_id) DO UPDATE
       SET github_username = $2,
           github_token_enc = $3,
           github_scope = $4,
           connected_at = now(),
           disconnected_at = NULL`,
    [telegramId, githubUsername, encToken, scope]
  );
}

async function disconnect(telegramId) {
  await pool.query(
    `UPDATE users SET github_token_enc = NULL, disconnected_at = now() WHERE telegram_id = $1`,
    [telegramId]
  );
}

async function getNotificationPrefs(telegramId) {
  const user = await getUser(telegramId);
  if (!user) return null;
  return {
    githubActivity: user.notif_github_activity,
    systemAlerts: user.notif_system_alerts,
    longOps: user.notif_long_ops,
    tokenHealth: user.notif_token_health,
    staleNudge: user.notif_stale_nudge,
    rollup: user.notif_rollup,
    quietStart: user.quiet_hours_start,
    quietEnd: user.quiet_hours_end,
  };
}

/** Cycles off -> daily -> weekly -> off, single-tap in the menu rather
 * than a separate picker screen for a 3-way choice. */
async function cycleRollup(telegramId) {
  const user = await getUser(telegramId);
  const next = { off: 'daily', daily: 'weekly', weekly: 'off' }[user.notif_rollup] || 'daily';
  await pool.query('UPDATE users SET notif_rollup = $1 WHERE telegram_id = $2', [next, telegramId]);
  return next;
}

/** Sets or clears quiet hours (both null = disabled). Hours are UTC — see
 * the poller's comment in index.js for why. */
async function setQuietHours(telegramId, start, end) {
  await pool.query('UPDATE users SET quiet_hours_start = $1, quiet_hours_end = $2 WHERE telegram_id = $3', [start, end, telegramId]);
}

async function toggleNotification(telegramId, key) {
  const columnMap = {
    githubActivity: 'notif_github_activity',
    systemAlerts: 'notif_system_alerts',
    longOps: 'notif_long_ops',
    tokenHealth: 'notif_token_health',
    staleNudge: 'notif_stale_nudge',
  };
  const column = columnMap[key];
  if (!column) throw new Error(`Unknown notification key: ${key}`);
  await pool.query(
    `UPDATE users SET ${column} = NOT ${column} WHERE telegram_id = $1`,
    [telegramId]
  );
  const user = await getUser(telegramId);
  return user[column];
}

module.exports = {
  getUser,
  isConnected,
  getDecryptedToken,
  saveConnection,
  disconnect,
  getNotificationPrefs,
  toggleNotification,
  cycleRollup,
  setQuietHours,
};
