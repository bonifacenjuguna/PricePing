/**
 * Guard used at the top of every handler that touches GitHub.
 * Returns the decrypted token if connected, otherwise sends the shared
 * connect prompt (which also resets BBTB to the disconnected-state bar,
 * so stale buttons from before a disconnect stop offering dead actions)
 * and returns null so the caller can bail out.
 *
 * Fetches the user row once — a single getUser() call rather than an
 * isConnected() + getDecryptedToken() pair that would each independently
 * call getUser() and cost two full Postgres queries where one suffices.
 * This function is called at the top of nearly every gated handler in the
 * bot, so keeping it to one query matters even though each query is cheap.
 */
async function requireConnected(ctx) {
  const telegramId = ctx.from.id;
  const users = require('./users');
  const user = await users.getUser(telegramId);
  const connected = !!(user && user.github_token_enc && !user.disconnected_at);

  if (!connected) {
    // Lazy require to avoid a circular dependency with handlers/start.js
    const { sendConnectPrompt } = require('../handlers/start');
    await sendConnectPrompt(ctx, {
      intro: '🔒 You need to connect your GitHub account first.',
    });
    return null;
  }

  const { decrypt } = require('./crypto');
  return decrypt(user.github_token_enc);
}

module.exports = requireConnected;
