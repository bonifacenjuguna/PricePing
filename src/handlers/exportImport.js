const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const format = require('../lib/format');
const ephemeral = require('../lib/ephemeral');
const defaultsLib = require('../lib/defaults');
const tags = require('../lib/tags');
const muteRules = require('../lib/automationMuteRules');
const backupRules = require('../lib/automationBackupRules');

const EXPORT_VERSION = 1;

/**
 * 💾 Export/Import — a portable JSON snapshot of everything that shapes
 * how GitroHub behaves for this person: Defaults, Notification prefs,
 * Tags (with their auto-rules), and Auto-Mute/Auto-Backup rules.
 *
 * Deliberately NOT included: the GitHub connection itself (re-connecting
 * is a normal OAuth flow, not something to smuggle through a settings
 * file), per-repo tag assignments, pins, or any activity/log history —
 * this is a config backup, not a full data export.
 *
 * Lives inline inside 📦 Storage & Data (no BBTB button of its own) —
 * inherits whatever BBTB Storage was already showing, same as 🗑️ Trash.
 */
async function showExportImportMenu(ctx) {
  const users = require('../lib/users');
  const connected = await users.isConnected(ctx.from.id);
  if (!connected) return;

  await ctx.reply(
    `💾 *Export/Import*\n\n` +
    `Back up your Defaults, Notification prefs, Tags \\(with their auto\\-rules\\), and Auto\\-Mute/Auto\\-Backup rules as a file you can restore later — handy before a reset or a big config change\\.\n\n` +
    `This does *not* include your GitHub connection, repo data, or activity history\\.`,
    { parse_mode: 'MarkdownV2', ...inline.exportImportMenu() }
  );
}

async function exportSettings(ctx) {
  const telegramId = ctx.from.id;
  const [defaults, notifPrefs, userTags, muteRulesList, backupRulesList] = await Promise.all([
    defaultsLib.getDefaults(telegramId),
    require('../lib/users').getNotificationPrefs(telegramId),
    tags.listTags(telegramId),
    muteRules.listMuteRules(telegramId),
    backupRules.listBackupRules(telegramId),
  ]);

  const tagById = new Map(userTags.map((t) => [t.id, t]));
  const exportData = {
    gitrohubExport: true,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    defaults: defaults || {},
    notifications: notifPrefs ? {
      notif_github_activity: notifPrefs.githubActivity,
      notif_system_alerts: notifPrefs.systemAlerts,
      notif_long_ops: notifPrefs.longOps,
      notif_token_health: notifPrefs.tokenHealth,
      notif_stale_nudge: notifPrefs.staleNudge,
      notif_rollup: notifPrefs.rollup,
      quiet_hours_start: notifPrefs.quietStart,
      quiet_hours_end: notifPrefs.quietEnd,
    } : {},
    tags: userTags.map((t) => ({
      name: t.name,
      emoji: t.emoji,
      colorClass: t.color_class,
      parentName: (t.parent_id && tagById.has(t.parent_id)) ? tagById.get(t.parent_id).name : null,
      autoRule: t.auto_rule_json ? JSON.parse(t.auto_rule_json) : null,
    })),
    muteRules: muteRulesList.map((r) => ({ field: r.field, op: r.op, value: r.value })),
    backupRules: backupRulesList.map((r) => ({ field: r.field, op: r.op, value: r.value })),
  };

  const json = JSON.stringify(exportData, null, 2);
  const filename = `gitrohub-settings-${new Date().toISOString().slice(0, 10)}.json`;
  await ctx.replyWithDocument(
    { source: Buffer.from(json, 'utf8'), filename },
    { caption: `💾 ${userTags.length} tag(s), ${muteRulesList.length} mute rule(s), ${backupRulesList.length} backup rule(s), plus your Defaults and Notification prefs.` }
  );
}

async function promptImportFile(ctx) {
  ctx.session.awaitingSettingsImport = true;
  await ctx.reply(
    '⬆️ Send the exported .json file (as a document attachment) to restore from, or ❌ Cancel.',
    bbtb.cancelOnly
  );
}

/** Called from bot.js's document router once a file arrives while
 * ctx.session.awaitingSettingsImport was set. Downloads, validates, and —
 * if it checks out — shows a summary + explicit confirm before touching
 * anything, since applying this overwrites the current Defaults and
 * Notification prefs outright. */
async function handleImportFile(ctx) {
  const doc = ctx.message.document;
  if (!doc.file_name.toLowerCase().endsWith('.json')) {
    await ctx.reply(format.errorMessage('Import failed', `${doc.file_name} isn\u2019t a .json file`, 'Send the file GitroHub\u2019s own Export produced.'));
    return;
  }
  if (doc.file_size > 2 * 1024 * 1024) {
    await ctx.reply(format.errorMessage('Import failed', 'that file is larger than a settings export should ever be', 'Send the file GitroHub\u2019s own Export produced.'));
    return;
  }

  let data;
  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const res = await fetch(fileLink.href, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    data = JSON.parse(text);
  } catch (err) {
    await ctx.reply(format.errorMessage('Import failed', 'couldn\u2019t read that as valid JSON', 'Make sure it\u2019s the unmodified file from Export.'));
    return;
  }

  if (!data || data.gitrohubExport !== true) {
    await ctx.reply(format.errorMessage('Import failed', 'this doesn\u2019t look like a GitroHub settings export', 'Use the file from 💾 Export Settings.'));
    return;
  }
  if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) {
    await ctx.reply(format.errorMessage('Import failed', `this file is from a newer export format (v${data.version}) than this bot understands (v${EXPORT_VERSION})`, 'Update the bot, or re-export from a matching version.'));
    return;
  }

  const tagCount = Array.isArray(data.tags) ? data.tags.length : 0;
  const muteCount = Array.isArray(data.muteRules) ? data.muteRules.length : 0;
  const backupCount = Array.isArray(data.backupRules) ? data.backupRules.length : 0;
  const hasDefaults = data.defaults && Object.keys(data.defaults).length > 0;
  const hasNotifs = data.notifications && Object.keys(data.notifications).length > 0;

  ctx.session.pendingImport = data;

  const summary =
    `📋 *Import Summary*\n\n` +
    `Exported: ${format.escapeMd(new Date(data.exportedAt || Date.now()).toLocaleDateString())}\n\n` +
    `${hasDefaults ? '✅' : '➖'} Defaults — ${hasDefaults ? 'will be *overwritten*' : 'nothing to import'}\n` +
    `${hasNotifs ? '✅' : '➖'} Notification prefs — ${hasNotifs ? 'will be *overwritten*' : 'nothing to import'}\n` +
    `${tagCount > 0 ? '✅' : '➖'} ${tagCount} tag${tagCount === 1 ? '' : 's'} — added/updated by name, nothing deleted\n` +
    `${muteCount > 0 ? '✅' : '➖'} ${muteCount} mute rule${muteCount === 1 ? '' : 's'} — added \\(duplicates skipped\\)\n` +
    `${backupCount > 0 ? '✅' : '➖'} ${backupCount} backup rule${backupCount === 1 ? '' : 's'} — added \\(duplicates skipped\\)\n\n` +
    `Proceed?`;

  await ctx.reply(summary, { parse_mode: 'MarkdownV2', ...inline.importConfirm() });
}

async function applyImport(ctx) {
  const data = ctx.session.pendingImport;
  delete ctx.session.pendingImport;
  if (!data) {
    await ctx.reply('Nothing to import — that confirmation expired. Please resend the file.');
    return;
  }

  const telegramId = ctx.from.id;
  const users = require('../lib/users');

  // Defaults — wholesale overwrite, one field at a time through the
  // normal setDefault() so the defaults_changelog audit trail still
  // records exactly what an import changed, same as a manual edit would.
  if (data.defaults) {
    const ALLOWED = ['default_visibility', 'default_commit_message', 'default_upload_path', 'default_sort', 'default_filter', 'auto_suggest_defaults'];
    for (const field of ALLOWED) {
      if (data.defaults[field] !== undefined) {
        await defaultsLib.setDefault(telegramId, field, data.defaults[field], { source: 'import' }).catch(() => {});
      }
    }
  }

  // Notifications — wholesale overwrite via direct column update, since
  // there's no per-field changelog for these the way Defaults has.
  if (data.notifications) {
    const { pool } = require('../db/postgres');
    const n = data.notifications;
    // Explicit `?? null` on every value — passing a bare `undefined` (which
    // happens if an older/partial export is missing a key) into a pg query
    // parameter isn't something to rely on across driver versions; forcing
    // it to `null` here makes the COALESCE below behave predictably no
    // matter what.
    await pool.query(
      `UPDATE users SET
         notif_github_activity = COALESCE($1, notif_github_activity),
         notif_system_alerts = COALESCE($2, notif_system_alerts),
         notif_long_ops = COALESCE($3, notif_long_ops),
         notif_token_health = COALESCE($4, notif_token_health),
         notif_stale_nudge = COALESCE($5, notif_stale_nudge),
         notif_rollup = COALESCE($6, notif_rollup),
         quiet_hours_start = $7,
         quiet_hours_end = $8
       WHERE telegram_id = $9`,
      [
        n.notif_github_activity ?? null, n.notif_system_alerts ?? null, n.notif_long_ops ?? null, n.notif_token_health ?? null,
        n.notif_stale_nudge ?? null, n.notif_rollup ?? null,
        n.quiet_hours_start ?? null, n.quiet_hours_end ?? null,
        telegramId,
      ]
    );
  }

  // Tags — additive, matched by name (createTag already upserts on
  // (telegram_id, name)). Two passes so parent references can resolve to
  // the freshly-created/updated ids regardless of array order.
  let tagsApplied = 0;
  if (Array.isArray(data.tags)) {
    const nameToId = new Map();
    for (const t of data.tags) {
      if (!t.name) continue;
      const created = await tags.createTag(telegramId, t.name, t.emoji || '🏷️', { colorClass: t.colorClass || 'default' });
      nameToId.set(t.name, created.id);
      tagsApplied++;
    }
    for (const t of data.tags) {
      if (!t.name || !nameToId.has(t.name)) continue;
      const id = nameToId.get(t.name);
      if (t.parentName && nameToId.has(t.parentName)) {
        await tags.createTag(telegramId, t.name, t.emoji || '🏷️', { parentId: nameToId.get(t.parentName), colorClass: t.colorClass || 'default' });
      }
      if (t.autoRule) {
        await tags.setAutoRule(telegramId, id, t.autoRule).catch(() => {});
      }
    }
  }

  // Mute/Backup rules — additive, skip exact duplicates (same field+op+value).
  let muteApplied = 0;
  if (Array.isArray(data.muteRules)) {
    const existing = await muteRules.listMuteRules(telegramId);
    const existingKeys = new Set(existing.map((r) => `${r.field}:${r.op}:${r.value}`));
    for (const r of data.muteRules) {
      if (!r.field || !r.op || r.value === undefined) continue;
      const key = `${r.field}:${r.op}:${r.value}`;
      if (existingKeys.has(key)) continue;
      await muteRules.createMuteRule(telegramId, r);
      existingKeys.add(key);
      muteApplied++;
    }
  }

  let backupApplied = 0;
  if (Array.isArray(data.backupRules)) {
    const existing = await backupRules.listBackupRules(telegramId);
    const existingKeys = new Set(existing.map((r) => `${r.field}:${r.op}:${r.value}`));
    for (const r of data.backupRules) {
      if (!r.field || !r.op || r.value === undefined) continue;
      const key = `${r.field}:${r.op}:${r.value}`;
      if (existingKeys.has(key)) continue;
      await backupRules.createBackupRule(telegramId, r);
      existingKeys.add(key);
      backupApplied++;
    }
  }

  const activity = require('../lib/activity');
  await activity.log(telegramId, '💾', `Settings imported → ${tagsApplied} tag(s), ${muteApplied} mute rule(s), ${backupApplied} backup rule(s)`);

  await ctx.reply(format.successMessage(`Imported ${tagsApplied} tag(s), ${muteApplied} mute rule(s), ${backupApplied} backup rule(s)${data.defaults ? ', and your Defaults' : ''}${data.notifications ? ' + Notification prefs' : ''}`));
  return showExportImportMenu(ctx);
}

module.exports = { showExportImportMenu, exportSettings, promptImportFile, handleImportFile, applyImport };
