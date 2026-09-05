const os = require('os');
const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const logger = require('../lib/logger');
const users = require('../lib/users');
const format = require('../lib/format');
const ephemeral = require('../lib/ephemeral');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const pgDb = require('../db/postgres');
const redisDb = require('../db/redis');
const config = require('../config');
const activity = require('../lib/activity');

const startTime = Date.now();

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

async function showSettings(ctx, { skipBbtb = false } = {}) {
  const telegramId = ctx.from.id;
  const user = await users.getUser(telegramId);
  const connected = !!(user && user.github_token_enc);

  const [pgStatus, redisStatus] = await Promise.all([pgDb.ping(), redisDb.ping()]);

  let rateLimitLine = 'Not connected — connect GitHub to see live usage';
  if (connected) {
    try {
      // Prefer the passively-captured value (from headers on
      // whatever GitHub calls already happened this session) over spending
      // a live request just to display a number. Falls back to an actual
      // getRateLimit() call only if nothing's been captured yet (e.g.
      // right after a fresh bot restart, before any other GitHub call).
      let rl = github.getLastKnownRateLimit();
      if (!rl) {
        const token = await users.getDecryptedToken(telegramId);
        const fresh = await github.getRateLimit(token);
        rl = { remaining: fresh.remaining, limit: fresh.limit, resetAt: fresh.reset * 1000 };
      }
      const resetMins = Math.max(0, Math.round((rl.resetAt - Date.now()) / 60000));
      const pct = rl.limit ? rl.remaining / rl.limit : 1;
      const dot = pct > 0.5 ? '🟢' : pct > 0.2 ? '🟡' : '🔴';
      rateLimitLine = `${dot} ${rl.remaining} / ${rl.limit} remaining \\(resets in ${resetMins}m\\)`;
    } catch (_) {
      rateLimitLine = 'Unable to fetch';
    }
  }

  const mem = process.memoryUsage();
  const memLine = `${Math.round(mem.rss / 1024 / 1024)}MB / ${Math.round(os.totalmem() / 1024 / 1024)}MB`;

  const dbLine = (s) => (s.ok ? `🟢 Connected \\(${s.ms}ms\\)` : `🔴 Unreachable \\(${format.escapeMd(s.error || 'timeout')}\\)`);
  const scopeLine = connected ? format.escapeMd((user.github_scope || 'repo').split(',').join(', ')) : '—';

  // 🤖 Automation stats — best-effort, a hiccup here should never block the
  // rest of this screen (system status has to stay reliable even if one
  // of the newer subsystems is having a bad moment).
  let automationLine = '⚙️ Not connected';
  if (connected) {
    try {
      const tags = require('../lib/tags');
      const muteRules = require('../lib/automationMuteRules');
      const [userTags, muteRulesList, lastRunResult] = await Promise.all([
        tags.listTags(telegramId),
        muteRules.listMuteRules(telegramId),
        activity.recent(telegramId, { limit: 1, automatedOnly: true }),
      ]);
      const activeTagRules = userTags.filter((t) => t.auto_rule_json).length;
      const activeMuteRules = muteRulesList.length;
      const lastRun = lastRunResult.rows[0] ? format.relativeTime(lastRunResult.rows[0].created_at) : 'never';
      automationLine =
        `├ Auto\\-Tag rules: ${activeTagRules} active\n` +
        `├ Auto\\-Mute rules: ${activeMuteRules} active\n` +
        `└ Last rules run: ${format.escapeMd(lastRun)}`;
    } catch (_) {
      automationLine = '└ Unable to fetch';
    }
  }

  const text =
    `⚙️ *Settings & System Status*\n\n` +
    `👤 *ACCOUNT*\n` +
    `├ GitHub: ${connected ? format.escapeMd(user.github_username) : 'Not connected'}\n` +
    `├ Scope: ${scopeLine}\n` +
    `└ Linked since: ${connected ? format.escapeMd(format.relativeTime(user.connected_at)) : '—'}\n\n` +
    `📡 *GITHUB API*\n` +
    `└ Rate limit: ${rateLimitLine}\n\n` +
    `🗄️ *DATABASE*\n` +
    `├ PostgreSQL: ${dbLine(pgStatus)}\n` +
    `└ Redis: ${dbLine(redisStatus)}\n\n` +
    `🤖 *AUTOMATION*\n` +
    `${automationLine}\n\n` +
    `🖥️ *SYSTEM*\n` +
    `├ Uptime: ${format.escapeMd(formatUptime(Date.now() - startTime))}\n` +
    `├ Host: Railway\n` +
    `├ Memory: ${format.escapeMd(memLine)}\n` +
    `└ Bot version: v${format.escapeMd(config.BOT_VERSION)}`;

  // System Alerts notification: push a distinct alert (not just an Activity
  // Log entry) when a DB is down and the person has this category on —
  // debounced to at most once per 10 minutes per DB. Checked BEFORE writing
  // this check's own log entries below, so the very first occurrence isn't
  // mistaken for "already alerted recently".
  await maybePushSystemAlert(telegramId, pgStatus, redisStatus, ctx);

  if (!pgStatus.ok) {
    await activity.log(telegramId, '⚠️', 'Postgres unreachable', { detail: pgStatus.error, isError: true }).catch(() => {});
  }
  if (!redisStatus.ok) {
    await activity.log(telegramId, '⚠️', 'Redis unreachable', { detail: redisStatus.error, isError: true }).catch(() => {});
  }

  // BBTB reply keyboard persists on screen once shown — only send the
  // marker message on first open, not on every chained refresh tap (#48),
  // or every refresh would needlessly resend it too (the exact clutter
  // this whole redesign pass was about avoiding elsewhere).
  if (!skipBbtb) await ephemeral.sendEphemeral(ctx, '⚙️ Settings', connected ? bbtb.settings : bbtb.disconnected);
  await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([[style.callback('🔄 Refresh Status', 'settings:refresh')]]),
  });
}

async function maybePushSystemAlert(telegramId, pgStatus, redisStatus, ctx) {
  const down = [];
  if (!pgStatus.ok) down.push('PostgreSQL');
  if (!redisStatus.ok) down.push('Redis');
  if (down.length === 0) return;

  try {
    const prefs = await users.getNotificationPrefs(telegramId);
    if (!prefs || !prefs.systemAlerts) return;

    const { rows } = await activity.recent(telegramId, { limit: 5, errorsOnly: true });
    const recentlyAlerted = rows.some((r) =>
      down.some((name) => r.summary.includes(`${name} unreachable`)) &&
      Date.now() - new Date(r.created_at).getTime() < 10 * 60 * 1000
    );
    if (recentlyAlerted) return;

    await ctx.reply(`⚠️ System Alert: ${down.join(' and ')} ${down.length > 1 ? 'are' : 'is'} unreachable. Some features may fail until this recovers.`);
  } catch (_) { /* best-effort — never let alerting itself crash Settings */ }
}

async function askDisconnect(ctx) {
  const connected = await users.isConnected(ctx.from.id);
  if (!connected) return; // defensive — BBTB shouldn't offer this while disconnected anyway

  await ctx.reply(
    `⚠️ Disconnect GitHub account\\?\n\n` +
    `This will:\n` +
    `• Remove your stored access token from GitroHub\n` +
    `• Require reconnecting before using any repo features again\n` +
    `• NOT affect anything on GitHub itself \\(no repos deleted\\)`,
    { parse_mode: 'MarkdownV2', ...inline.disconnectConfirm() }
  );
}

async function executeDisconnect(ctx) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'disconnect', () => _executeDisconnect(ctx));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeDisconnect(ctx) {
  // Tear down every live webhook on GitHub's side BEFORE wiping the token —
  // users.disconnect() sets github_token_enc to NULL, and once that's gone
  // there's no way to call GitHub's API to remove anything. This is what
  // makes the Disconnect confirmation screen's promise ("will NOT affect
  // anything on GitHub itself") actually true — a webhook is a real
  // resource sitting on the person's actual repo settings otherwise.
  const token = await users.getDecryptedToken(ctx.from.id);
  const repoWebhooks = require('../lib/repoWebhooks');
  const notificationMutes = require('../lib/notificationMutes');
  if (token) {
    const user = await repoCacheGetUserSafe(ctx.from.id, token);
    const registrations = await repoWebhooks.getAllForUser(ctx.from.id).catch(() => []);
    for (const reg of registrations) {
      try {
        if (user) await github.deleteWebhook(token, user.login, reg.repo_name, reg.webhook_id);
      } catch (err) {
        // Best-effort — the repo may already be deleted, or access may
        // already be partially revoked. Either way, disconnect must still
        // complete; a webhook GitHub itself no longer has a valid target
        // for isn't a reason to block the person from disconnecting.
        logger.warn('Could not remove webhook during disconnect', { repo: reg.repo_name, message: err.message });
      }
    }
    await repoWebhooks.removeAllForUser(ctx.from.id).catch(() => {});
    await notificationMutes.unmuteAllForUser(ctx.from.id).catch(() => {});
  }

  await users.disconnect(ctx.from.id);
  const repoCache = require('../lib/repoCache');
  repoCache.invalidateUser(ctx.from.id);
  await activity.log(ctx.from.id, '🚪', 'Disconnected GitHub account');
  const accessLog = require('../lib/accessLog');
  await accessLog.record(ctx.from.id, 'disconnected');

  const { sendConnectPrompt } = require('./start');
  await sendConnectPrompt(ctx, {
    intro: '✅ Disconnected\\. Your GitHub account is no longer linked\\.',
  });
}

/** Small local wrapper so a failure fetching the username never blocks the
 * webhook cleanup loop above — worst case, cleanup is skipped for this run
 * and the DB rows still get cleared, rather than the whole disconnect failing. */
async function repoCacheGetUserSafe(telegramId, token) {
  try {
    const repoCache = require('../lib/repoCache');
    return await repoCache.getUser(telegramId, token);
  } catch (err) {
    logger.warn('Could not fetch username during disconnect cleanup', { message: err.message });
    return null;
  }
}

async function showNotifications(ctx) {
  const connected = await users.isConnected(ctx.from.id);
  if (!connected) return;

  const prefs = await users.getNotificationPrefs(ctx.from.id);
  await ctx.reply(
    `🔔 *Notifications*\n\nChoose what GitroHub should alert you about:`,
    { parse_mode: 'MarkdownV2', ...inline.notificationsMenu(prefs) }
  );
}

async function toggleNotification(ctx, key) {
  await users.toggleNotification(ctx.from.id, key);
  const prefs = await users.getNotificationPrefs(ctx.from.id);
  await ctx.editMessageReplyMarkup(inline.notificationsMenu(prefs).reply_markup);
}

/** Rollup cycles in place (off -> daily -> weekly -> off). */
async function cycleRollup(ctx) {
  await users.cycleRollup(ctx.from.id);
  const prefs = await users.getNotificationPrefs(ctx.from.id);
  await ctx.editMessageReplyMarkup(inline.notificationsMenu(prefs).reply_markup);
}

/** Prompts for quiet hours as "start-end" (e.g. "22-7"), simplest input
 * that covers the wrap-past-midnight case without a full time-picker UI. */
async function promptQuietHours(ctx) {
  ctx.session.awaitingQuietHours = true;
  await ctx.reply('🌙 Send quiet hours as `start-end` in 24h UTC \\(e\\.g\\. `22-7`\\), or `off` to disable\\.', { parse_mode: 'MarkdownV2' });
}

async function handleQuietHoursInput(ctx, text) {
  ctx.session.awaitingQuietHours = false;
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'off') {
    await users.setQuietHours(ctx.from.id, null, null);
    await ctx.reply('🌙 Quiet hours disabled.');
    return showNotifications(ctx);
  }
  const match = trimmed.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return ctx.reply('Didn\u2019t understand that — use `start-end`, e.g. `22-7`, or `off`.');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 0 || start > 23 || end < 0 || end > 23) return ctx.reply('Hours must be 0–23.');
  await users.setQuietHours(ctx.from.id, start, end);
  await ctx.reply(`🌙 Quiet hours set: ${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00 UTC.`);
  return showNotifications(ctx);
}

module.exports = {
  showSettings, askDisconnect, executeDisconnect, showNotifications, toggleNotification,
  cycleRollup, promptQuietHours, handleQuietHoursInput,
};
