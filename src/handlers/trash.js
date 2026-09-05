const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const requireConnected = require('../lib/requireConnected');
const trash = require('../lib/trash');

/**
 * 🗑️ Trash — lives inline inside 📦 Storage & Data (no new BBTB row), so it
 * inherits whatever BBTB Storage was already showing rather than sending
 * its own marker.
 */
async function showTrash(ctx) {
  const entries = await trash.list(ctx.from.id);

  let text = `🗑️ *Trash*\n\nRepos deleted through the bot stay recoverable here until they expire\\.\n\n`;
  text += entries.length === 0
    ? 'Nothing in Trash right now\\.'
    : entries.map((e, i) => {
        const daysLeft = Math.max(0, Math.ceil((new Date(e.expires_at).getTime() - Date.now()) / 86400000));
        return `${i + 1}\\. *${format.escapeMd(e.original_name)}* — ${daysLeft}d left`;
      }).join('\n');

  const rows = entries.map((e) => [style.callback(`♻️ Restore: ${e.original_name}`, `trash:restore:${e.id}`)]);
  rows.push([style.callback('⬅️ Back', 'storage:back', style.BLUE)]);

  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function requestRestore(ctx, trashId) {
  const entry = await trash.get(ctx.from.id, trashId);
  if (!entry || entry.restored_at || new Date(entry.expires_at).getTime() <= Date.now()) {
    await ctx.reply('That trash entry is no longer available (already restored, or expired).');
    return showTrash(ctx);
  }

  const token = await requireConnected(ctx);
  if (!token) return;

  const github = require('../lib/github');
  const repoCache = require('../lib/repoCache');
  const user = await repoCache.getUser(ctx.from.id, token);

  // Name-collision check — the whole point of asking first instead of just
  // trying and handling the 422: a person restoring something explicitly
  // wants their old repo back, not to accidentally learn mid-restore that
  // it collides with something newer they created under the same name.
  let exists = false;
  try {
    await github.getRepo(token, user.login, entry.original_name);
    exists = true;
  } catch (err) {
    if (err.status !== 404) {
      await ctx.reply(format.errorMessage('Couldn\u2019t check for a name conflict', err.message, 'Try again.'));
      return;
    }
  }

  if (exists) {
    ctx.session.awaitingTrashRestoreName = { trashId: entry.id };
    await ctx.reply(
      format.errorMessage(
        `"${entry.original_name}" already exists`,
        'a repo with this name is already in your account',
        'Send a different name to restore it under, or ❌ Cancel.'
      ),
      bbtb.cancelOnly
    );
    return;
  }

  return performRestore(ctx, entry, entry.original_name);
}

/** Called from the global text router (bot.js) once a replacement name
 * arrives after a collision was detected above. */
async function handleRestoreNameInput(ctx) {
  const state = ctx.session.awaitingTrashRestoreName;
  delete ctx.session.awaitingTrashRestoreName;
  if (!state) return;

  if (ctx.message.text === '❌ Cancel') {
    await ctx.reply('Restore cancelled.');
    return showTrash(ctx);
  }

  const entry = await trash.get(ctx.from.id, state.trashId);
  if (!entry || entry.restored_at) {
    await ctx.reply('That trash entry is no longer available.');
    return showTrash(ctx);
  }

  const newName = ctx.message.text.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(newName)) {
    await ctx.reply(format.errorMessage('Invalid repo name', 'GitHub repo names can only contain letters, numbers, dots, hyphens, and underscores', 'Send a valid name, or ❌ Cancel.'));
    ctx.session.awaitingTrashRestoreName = state;
    return;
  }

  const token = await requireConnected(ctx);
  if (!token) return;
  const github = require('../lib/github');
  const repoCache = require('../lib/repoCache');
  const user = await repoCache.getUser(ctx.from.id, token);
  try {
    await github.getRepo(token, user.login, newName);
    await ctx.reply(format.errorMessage(`"${newName}" also already exists`, 'pick a name that isn\u2019t already in your account', 'Send another name, or ❌ Cancel.'));
    ctx.session.awaitingTrashRestoreName = state;
    return;
  } catch (err) {
    if (err.status !== 404) {
      await ctx.reply(format.errorMessage('Couldn\u2019t check for a name conflict', err.message, 'Try again.'));
      ctx.session.awaitingTrashRestoreName = state;
      return;
    }
  }

  return performRestore(ctx, entry, newName);
}

/** Creates the repo fresh, then re-downloads the backup zip from Telegram
 * (its file_id, stored on the trash entry, IS the storage — see
 * lib/trash.js) and commits every file from it in one shot. The person
 * doesn't have to re-upload anything; if they want to change something
 * afterward, that's just normal Browse Files → Edit on the restored repo,
 * same as any other. */
async function performRestore(ctx, entry, newName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  await ctx.reply(`♻️ Restoring "${newName}"...`);

  try {
    const github = require('../lib/github');
    const repoCache = require('../lib/repoCache');
    const repo = await github.createRepo(token, {
      name: newName,
      isPrivate: entry.visibility === 'private',
      description: entry.description,
    });
    repoCache.invalidateRepos(ctx.from.id);

    const fileLink = await ctx.telegram.getFileLink(entry.backup_file_id);
    const res = await fetch(fileLink.href, { signal: AbortSignal.timeout(30000) });
    const buffer = Buffer.from(await res.arrayBuffer());

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries().filter((e) => !e.isDirectory);

    // GitHub's zipball archive puts everything under a single top-level
    // "<owner>-<repo>-<sha>/" folder — strip it before committing.
    const topLevels = new Set(zipEntries.map((e) => e.entryName.split('/')[0]));
    let stripPrefix = '';
    if (topLevels.size === 1) {
      const only = [...topLevels][0];
      if (zipEntries.every((e) => e.entryName.startsWith(`${only}/`))) stripPrefix = `${only}/`;
    }

    const files = zipEntries
      .map((e) => ({
        path: stripPrefix ? e.entryName.slice(stripPrefix.length) : e.entryName,
        content: e.getData(), // raw Buffer — same binary-safe handling as every other commit path in this bot
      }))
      .filter((f) => f.path); // README.md is intentionally included here — it overwrites auto_init's placeholder with the real backed-up one

    if (files.length > 0) {
      await github.commitMultipleFiles(token, repo.owner.login, repo.name, files, 'Restore from Trash');
    }

    await trash.markRestored(ctx.from.id, entry.id);
    const activity = require('../lib/activity');
    await activity.log(ctx.from.id, '♻️', `Restored from Trash → ${newName}`);

    await ctx.reply(
      `✅ Restored: ${repo.name}\n🔗 ${repo.html_url}\n\nEverything from the backup is committed — browse or edit it like any other repo if you want to change anything.`,
      bbtb.mainMenu
    );
  } catch (err) {
    await ctx.reply(format.errorMessage(`Couldn\u2019t restore "${newName}"`, err.message, 'Try again, or use 🗑️ Trash to retry later.'));
  }
}

module.exports = { showTrash, requestRestore, handleRestoreNameInput };
