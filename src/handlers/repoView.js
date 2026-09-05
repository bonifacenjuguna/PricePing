const github = require('../lib/github');
const config = require('../config');
const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const users = require('../lib/users');
const pins = require('../lib/pins');
const tags = require('../lib/tags');
const pathMemory = require('../lib/pathMemory');
const recentlyViewed = require('../lib/recentlyViewed');
const repoWebhooks = require('../lib/repoWebhooks');
const notificationMutes = require('../lib/notificationMutes');
const ephemeral = require('../lib/ephemeral');

/** #2 — undo history now holds up to 5 entries instead of just the single
 * most recent one; each gets its own id so a specific entry can be
 * reversed even if something else happened after it. */
const MAX_UNDO_HISTORY = 5;
function pushUndo(ctx, entry) {
  ctx.session.undoHistory = ctx.session.undoHistory || [];
  ctx.session.undoHistory.unshift({ id: Date.now(), ...entry });
  ctx.session.undoHistory = ctx.session.undoHistory.slice(0, MAX_UNDO_HISTORY);
  return ctx.session.undoHistory[0].id;
}

/**
 * Storage & Data's "auto-delete on repo deletion" setting — when on (the
 * default), removes any pins/tags/path-memory GitroHub kept for a repo the
 * moment it's actually deleted from GitHub, so orphaned data doesn't pile up.
 */
async function cleanupOrphanedData(telegramId, repoName) {
  // Webhook/mute rows are unconditional, regardless of the auto-cleanup
  // preference below — unlike pins/tags (legitimate to keep in case the
  // repo gets recreated), a webhook_id record serves no purpose once
  // GitHub itself has already deleted the webhook along with the repo.
  const repoWebhooks = require('../lib/repoWebhooks');
  const notificationMutes = require('../lib/notificationMutes');
  await Promise.all([
    repoWebhooks.remove(telegramId, repoName),
    notificationMutes.unmute(telegramId, repoName),
  ]);

  const user = await users.getUser(telegramId);
  if (!user || !user.auto_cleanup_on_delete) return;
  await Promise.all([
    pins.removeByRepoName(telegramId, repoName),
    tags.removeAllForRepo(telegramId, repoName),
    pathMemory.removeForRepo(telegramId, repoName),
  ]);
}

async function showRepoView(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  let repo;
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    repo = await github.getRepo(token, user.login, repoName);
  } catch (err) {
    return ctx.reply(format.errorMessage(
      `Couldn\u2019t open "${repoName}"`,
      err.status === 404 ? 'repository not found or was renamed' : err.message,
      'Go back and refresh your repo list.'
    ));
  }

  // Language % breakdown (all languages, not just the dominant one) and real
  // tree-derived size/file/folder counts — both best-effort, since an empty
  // repo has no tree/languages at all and shouldn't block the rest of the card.
  let langBreakdown = 'No language detected';
  try {
    const languages = await repoCache.getLanguages(ctx.from.id, repo.owner.login, repo.name, token);
    langBreakdown = format.languageBreakdown(languages);
  } catch (_) {
    langBreakdown = repo.language || 'No language detected';
  }

  let treeStats = null;
  try {
    treeStats = await repoCache.getTreeStats(ctx.from.id, repo.owner.login, repo.name, token);
  } catch (_) { /* empty/new repo — fall back to repo.size below */ }

  // #56 — language breakdown is also GitHub's own async background scan
  // (linguist), not synchronous with a commit. "No language detected" is
  // only genuinely correct for a truly empty repo (fileCount === 0) — if
  // the repo actually has files but the breakdown still came back empty,
  // that's the specific symptom of detection not having caught up yet
  // (right after Create Repo, Replace Folder, or a first Upload), not a
  // real absence of code. Caveat it instead of stating it as settled fact.
  const langLagNote = (langBreakdown === 'No language detected' && treeStats && treeStats.fileCount > 0)
    ? '\n_\\(GitHub may still be detecting this — check back in a minute if it should have one\\.\\)_'
    : '';

  const [pinned, repoTags, readmeResult, commits] = await Promise.all([
    pins.isPinned(ctx.from.id, repo.name),
    tags.tagsForRepo(ctx.from.id, repo.name),
    // README preview (#14) and the health flag's hasReadme (#15) share this
    // one fetch — success means it exists (and gives us preview text),
    // 404 means it doesn't, anything else is treated as "unknown, don't
    // penalize the health flag for a fetch error that isn't really about
    // the repo".
    github.getFileContent(token, repo.owner.login, repo.name, 'README.md')
      .then((f) => ({ exists: true, content: f.content.toString('utf8') }))
      .catch((err) => ({ exists: err.status === 404 ? false : undefined, content: null })),
    github.getRecentCommits(token, repo.owner.login, repo.name, 3).catch(() => []),
  ]);

  const tagLine = repoTags.length > 0
    ? `🏷️ ${format.escapeMd(repoTags.map((t) => `${t.emoji} ${t.name}`).join(' · '))}`
    : '';

  // Forked-from (#1) — GitHub's single-repo GET already includes `parent`
  // for forks, no extra call needed; the repo LIST endpoint doesn't, which
  // is why list screens only show a plain "🍴 Fork" badge, not the source.
  const forkedFrom = repo.fork && repo.parent ? repo.parent.full_name : undefined;

  const card = format.repoCard(repo, {
    pinned,
    sizeBytes: treeStats ? treeStats.sizeBytes : undefined,
    tagLine,
    forkedFrom,
    hasReadme: readmeResult.exists,
  });

  const fileFolderLine = treeStats
    ? `▸ ${treeStats.fileCount} files · ${treeStats.folderCount} folders${treeStats.sizeIncomplete ? ' (size is a lower bound — some very large files weren\u2019t sized)' : ''}\n`
    : '';

  // #11 — last-synced note, since tree-based sizes are cached (not live)
  const syncedNote = treeStats && treeStats.fetchedAt
    ? `▸ 🕓 Size as of ${format.escapeMd(format.relativeTime(treeStats.fetchedAt))}\n`
    : '';

  // #7 — rename history note, only within the last 2 weeks so it doesn't
  // linger indefinitely once it's no longer useful context
  const renameInfo = await activity.recentRename(ctx.from.id, repo.name, 14).catch(() => null);
  const renameNote = renameInfo
    ? `▸ ✏️ Renamed from *${format.escapeMd(renameInfo.previousName)}* ${format.escapeMd(format.relativeTime(renameInfo.renamedAt))}\n`
    : '';

  // README preview (#14) — first 3 non-empty lines, truncated hard so a huge
  // README can't blow out the message.
  let readmeSection = '';
  if (readmeResult.exists && readmeResult.content) {
    const lines = readmeResult.content.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
    const preview = lines.join('\n').slice(0, 300);
    readmeSection = `\n\n📖 *README PREVIEW*\n${format.escapeMd(preview)}${readmeResult.content.length > 300 ? '…' : ''}`;
  }

  // Last commits preview (#5)
  let commitsSection = '';
  if (commits.length) {
    const lines = commits.map((c) => `▸ \`${c.sha}\` ${format.escapeMd(c.message)} — ${format.escapeMd(format.relativeTime(c.date))}`);
    commitsSection = `\n\n📜 *RECENT COMMITS*\n${lines.join('\n')}`;
  }

  const text =
    `${card}\n\n` +
    `💻 *LANGUAGES*\n${format.escapeMd(langBreakdown)}${langLagNote}\n\n` +
    `📊 *DETAILS*\n` +
    fileFolderLine +
    syncedNote +
    renameNote +
    `▸ Last commit: ${format.escapeMd(format.relativeTime(repo.pushed_at))}\n` +
    `▸ Created: ${format.escapeMd(format.relativeTime(repo.created_at))}` +
    commitsSection +
    readmeSection;

  ctx.session = ctx.session || {};
  ctx.session.currentRepo = repo.name;
  ctx.session.repoOwner = repo.owner.login;
  ctx.session.repoUrl = repo.html_url; // feeds Clone URL / Open in Browser buttons

  // Surprise feature — recently viewed, best-effort, never blocks the view itself
  recentlyViewed.record(ctx.from.id, repo.name).catch(() => {});

  // #1 — webhook/notifications state for this repo
  const webhookReg = await repoWebhooks.get(ctx.from.id, repo.name).catch(() => null);
  let webhookState = 'none';
  if (webhookReg) {
    const muted = await notificationMutes.isMuted(ctx.from.id, repo.name).catch(() => false);
    webhookState = muted ? 'muted' : 'active';
  }

  // Reply keyboard (BBTB) and inline keyboard can't share one message — send
  // the BBTB once via a tiny marker message, then the real content with only inline.
  await ephemeral.sendEphemeral(ctx, '📦 Repo View', bbtb.repoView);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.repoActions(repo.name, pinned, repo.html_url, webhookState, readmeResult.exists) });

  // 🤖 Automation — surface any active auto-tag rule that matches this repo
  // and isn't applied yet, as a one-tap suggestion. Best-effort: a rules
  // lookup hiccup here should never block the repo card itself from showing.
  try {
    const matches = await tags.evaluateAutoRules(ctx.from.id, repo);
    const already = new Set(repoTags.map((t) => t.id));
    const unapplied = matches.find((m) => !already.has(m.id));
    if (unapplied) {
      await ctx.reply(
        `🤖 Auto\\-tag rule matches: ${unapplied.emoji} *${format.escapeMd(unapplied.name)}*\\. Apply it to this repo?`,
        { parse_mode: 'MarkdownV2', ...inline.autoTagSuggestion(repo.name, unapplied.id) }
      );
    }
  } catch (_) { /* non-fatal — Automation suggestions are a bonus, not a dependency */ }
}

async function showRepoDetails(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);
  let treeStats = null;
  try {
    treeStats = await repoCache.getTreeStats(ctx.from.id, user.login, repoName, token);
  } catch (_) { /* best-effort, non-fatal */ }

  const sizeBytes = treeStats ? treeStats.sizeBytes : (repo.size || 0) * 1024;
  const fileLine = treeStats
    ? `📂 ${treeStats.fileCount} files · ${treeStats.folderCount} folders · ${format.escapeMd(format.formatBytes(sizeBytes))} total\n\n`
    : `📂 ${format.escapeMd(format.formatBytes(sizeBytes))} total\n\n`;

  const text =
    `🔍 *${format.escapeMd(repo.name)} — Full Details*\n\n` +
    `📊 *Stats*\n` +
    `⭐ ${repo.stargazers_count} stars · 🍴 ${repo.forks_count} forks · 👁 ${repo.watchers_count} watchers\n` +
    fileLine +
    `🌐 *Activity*\n` +
    `Created: ${format.escapeMd(format.relativeTime(repo.created_at))}\n` +
    `Last push: ${format.escapeMd(format.relativeTime(repo.pushed_at))}\n` +
    `Default branch: ${format.escapeMd(repo.default_branch)}\n\n` +
    `🔗 *Links*\n${format.escapeMd(repo.html_url)}`;

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
}

async function askDeleteRepo(ctx, repoName) {
  await ctx.reply(
    `⚠️ Delete "${format.escapeMd(repoName)}" from GitHub? \nA backup is kept in 🗑️ Trash \\(Settings → 📦 Storage\\) for a while in case you change your mind\\.`,
    { parse_mode: 'MarkdownV2', ...inline.deleteRepoConfirm(repoName) }
  );
}

async function executeDeleteRepo(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'deleteRepo', async () => {
    try {
      const user = await repoCache.getUser(ctx.from.id, token);
      const repo = await github.getRepo(token, user.login, repoName);

      // 🗑️ Trash — back up before the real GitHub delete happens. If the
      // backup itself fails for any reason, the person gets a clear
      // warning and a chance to bail rather than silently losing the
      // safety net GitroHub just told them they'd have.
      let backupNote = '';
      try {
        const users = require('../lib/users');
        const trash = require('../lib/trash');
        const dbUser = await users.getUser(ctx.from.id);
        const zipBuffer = await github.downloadZip(token, user.login, repoName, repo.default_branch);
        const backupMsg = await ctx.replyWithDocument(
          { source: zipBuffer, filename: `${repoName}-trash-backup.zip` },
          { caption: `🗑️ Trash backup: ${repoName} (kept ${dbUser.trash_retention_days}d)` }
        );
        await trash.add(ctx.from.id, {
          originalName: repoName,
          description: repo.description,
          visibility: repo.private ? 'private' : 'public',
          backupFileId: backupMsg.document.file_id,
          retentionDays: dbUser.trash_retention_days,
        });
        backupNote = ` — backed up to 🗑️ Trash for ${dbUser.trash_retention_days}d`;
      } catch (backupErr) {
        await ctx.reply(format.errorMessage(
          'Couldn\u2019t back up before deleting',
          backupErr.message,
          `Nothing was deleted. Open "${repoName}" and tap 🗑️ Delete Repo again to retry, or delete it manually on GitHub if this keeps failing.`
        ));
        return;
      }

      await github.deleteRepo(token, user.login, repoName);
      repoCache.invalidateRepos(ctx.from.id);
      repoCache.invalidateLanguages(ctx.from.id, repoName);
      repoCache.invalidateTreeStats(ctx.from.id, repoName);
      await activity.log(ctx.from.id, '🗑', `Deleted repo → ${repoName}${backupNote}`);
      await cleanupOrphanedData(ctx.from.id, repoName);
      await ctx.reply(format.successMessage(`Deleted repository "${repoName}"`, `Recoverable from 🗑️ Trash if you change your mind.`), bbtb.mainMenu);
    } catch (err) {
      await activity.log(ctx.from.id, '⚠️', `Delete repo failed → ${repoName}`, { detail: err.message, isError: true });
      const errorHelpers = require('../lib/errorHelpers');
      const wasAuthError = await errorHelpers.replyGithubError(ctx, err, `Couldn\u2019t delete "${repoName}"`);
      if (!wasAuthError) {
        await ctx.reply(format.errorMessage(
          `Couldn\u2019t delete "${repoName}"`,
          err.message,
          'Check your token permissions and try again.'
        ));
      }
    }
  });
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function askToggleVisibility(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);

  const text = repo.private
    ? `🔒 *${format.escapeMd(repoName)}* is currently Private\\.\n\nSwitching to Public will:\n• Make the code visible to anyone\n• Show it in your public GitHub profile`
    : `🌐 *${format.escapeMd(repoName)}* is currently Public\\.\n\nSwitching to Private will:\n• Hide it from search and public listings\n• Revoke access for anyone who isn\u2019t a collaborator`;

  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.visibilityConfirm(repoName, repo.private) });
}

async function executeToggleVisibility(ctx, repoName) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'toggleVisibility', () => _executeToggleVisibility(ctx, repoName));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeToggleVisibility(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const repo = await github.getRepo(token, user.login, repoName);
    const wasPrivate = repo.private;
    const updated = await github.setVisibility(token, user.login, repoName, !repo.private);
    repoCache.invalidateRepos(ctx.from.id);
    await activity.log(ctx.from.id, '🔒', `Visibility changed → ${repoName} (${repo.private ? 'Private→Public' : 'Public→Private'})`);
    // #2 — Undo, now pushed into a short history list instead of a single slot
    const undoId = pushUndo(ctx, { type: 'visibility', repoName, previousValue: wasPrivate });
    await ctx.reply(format.successMessage(
      `Visibility updated: ${repoName} is now ${updated.private ? '🔒 Private' : '🌐 Public'}`
    ));
    await ctx.reply('You can undo this if it was a mistake:', Markup.inlineKeyboard([[style.callback('↩️ Undo', `undo:action:${undoId}`)]]));
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Visibility change failed → ${repoName}`, { detail: err.message, isError: true });
    const errorHelpers = require('../lib/errorHelpers');
    const wasAuthError = await errorHelpers.replyGithubError(ctx, err, 'Couldn\u2019t change visibility');
    if (!wasAuthError) {
      await ctx.reply(format.errorMessage(
        `Couldn\u2019t change visibility`,
        err.message.includes('403') ? 'your token may not have admin rights on this repo' : err.message,
        'Try reconnecting GitHub with full scope.'
      ));
    }
  }
}

/** ✏️ Description — low-risk/instantly-reversible, unlike
 * Rename (which affects clone URLs), so no confirm step, matching how
 * Description is entered during Create Repo (type it, move on). */
async function askEditDescription(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  ctx.session.editingDescription = repoName;
  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);
  ctx.session.editingDescriptionPrevious = repo.description || ''; // feeds #11 Undo
  await ctx.reply(
    `✏️ Current description: ${repo.description ? `"${repo.description}"` : '(none)'}\n\nSend a new description, or ⏭️ Skip to clear it.`,
    bbtb.cancelWithSkip
  );
}

/** Called from the text router when ctx.session.editingDescription is set */
async function handleDescriptionInput(ctx, text) {
  const repoName = ctx.session.editingDescription;
  delete ctx.session.editingDescription;
  if (!repoName) return;

  const token = await requireConnected(ctx);
  if (!token) return;

  const description = text === '⏭️ Skip' ? '' : text.trim();
  const previousDescription = ctx.session.editingDescriptionPrevious || '';
  delete ctx.session.editingDescriptionPrevious;
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    await github.updateDescription(token, user.login, repoName, description);
    repoCache.invalidateRepos(ctx.from.id);
    await activity.log(ctx.from.id, '✏️', `Description updated → ${repoName}`);
    // #2 — Undo. Colorless: a value pick, same as any other adjustment.
    const undoId = pushUndo(ctx, { type: 'description', repoName, previousValue: previousDescription });
    await ephemeral.sendEphemeral(ctx, format.successMessage('Description updated'), bbtb.repoView);
    await ctx.reply('You can undo this if it was a mistake:', Markup.inlineKeyboard([[style.callback('↩️ Undo', `undo:action:${undoId}`)]]));
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Description update failed → ${repoName}`, { detail: err.message, isError: true });
    await ctx.reply(format.errorMessage('Couldn\u2019t update description', err.message, 'Try again.'));
  }
  return showRepoView(ctx, repoName);
}

const LICENSE_OPTIONS = [
  ['mit', 'MIT'],
  ['apache-2.0', 'Apache 2.0'],
  ['gpl-3.0', 'GPL v3'],
  ['bsd-3-clause', 'BSD'],
];

/** ⚖️ License — GitHub has no "set license" API field; a
 * repo's detected license comes from GitHub actually scanning a LICENSE
 * file (licensee). Same mechanism as the visibility flow otherwise:
 * show current state, confirm before changing. */
async function showLicenseMenu(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);
  const current = repo.license ? (repo.license.name || repo.license.spdx_id) : 'No license';

  const rows = LICENSE_OPTIONS.map(([key, label]) =>
    [style.callback(label, `repo:license:confirm:${repoName}:${key}`, style.GREEN)]
  );
  rows.push([style.callback('🚫 None', `repo:license:confirm:${repoName}:none`, style.GREEN)]);
  rows.push([style.callback('❌ Cancel', `repo:license:cancel:${repoName}`, style.RED)]);

  await ctx.reply(
    `⚖️ *${format.escapeMd(repoName)}* — current license: ${format.escapeMd(current)}\n\nChoose a new one, or ❌ Cancel:`,
    { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) }
  );
}

async function executeSetLicense(ctx, repoName, licenseKey) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'setLicense', () => _executeSetLicense(ctx, repoName, licenseKey));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeSetLicense(ctx, repoName, licenseKey) {
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    if (licenseKey === 'none') {
      // Remove the existing LICENSE file, if any — this is what makes the
      // repo show "No license" again (GitHub can't be told directly).
      try {
        const existing = await github.getFileContent(token, user.login, repoName, 'LICENSE');
        await github.deleteFile(token, user.login, repoName, 'LICENSE', existing.sha, 'Remove license');
      } catch (_) { /* no LICENSE file existed — nothing to remove */ }
    } else {
      const body = await github.getLicenseText(token, licenseKey);
      let existingSha = null;
      try {
        const existing = await github.getFileContent(token, user.login, repoName, 'LICENSE');
        existingSha = existing.sha;
      } catch (_) { /* no existing LICENSE file — creating fresh */ }
      await github.putFile(token, user.login, repoName, 'LICENSE', body, 'Update license', existingSha);
    }
    repoCache.invalidateRepos(ctx.from.id);
    repoCache.invalidateTreeStats(ctx.from.id, repoName);
    await activity.log(ctx.from.id, '⚖️', `License updated → ${repoName} (${licenseKey})`);
    // #55 — GitHub's license detection is an async background scan
    // (licensee), not synchronous with the commit. Re-showing the repo
    // card immediately would display GitHub's still-stale answer as if it
    // were current — misleading, since it visibly "catches up" a minute
    // later with no action from the person. Confirm the commit succeeded
    // without claiming the shown license is already accurate, and let
    // them check back on their own terms instead of auto-rendering it.
    await ctx.reply(
      `✅ License commit pushed to ${repoName}.\n\n⏳ GitHub can take a moment to actually detect the new license from the file — if it still shows the old one when you check, give it a minute and look again.`,
      Markup.inlineKeyboard([[style.callback(`📦 View ${repoName}`, `repo:${repoName}`)]])
    );
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `License update failed → ${repoName}`, { detail: err.message, isError: true });
    await ctx.reply(format.errorMessage('Couldn\u2019t update license', err.message, 'Try again.'));
    return showRepoView(ctx, repoName);
  }
}

/** #3 — Clone URL, sent as its own message so the ```code block``` is
 * easily tap-to-copy in Telegram. */
async function showCloneUrl(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);
  // SSH and gh-cli variants alongside HTTPS, each its own code
  // block so any one of the three is independently tap-to-copy.
  const sshUrl = `git@github.com:${user.login}/${repoName}.git`;
  await ctx.reply(
    `📋 *Clone ${format.escapeMd(repoName)}*\n\n` +
    `HTTPS:\n\`\`\`\ngit clone ${format.escapeCodeBlock(repo.clone_url)}\n\`\`\`\n` +
    `SSH:\n\`\`\`\ngit clone ${format.escapeCodeBlock(sshUrl)}\n\`\`\`\n` +
    `GitHub CLI:\n\`\`\`\ngh repo clone ${format.escapeCodeBlock(user.login + '/' + repoName)}\n\`\`\``,
    { parse_mode: 'MarkdownV2' }
  );
}

/** #2 — undo by specific id, since undo history now holds up to 5 entries
 * rather than a single slot; reversing an older entry doesn't require
 * reversing everything after it too. */
async function undoAction(ctx, undoId) {
  const history = ctx.session.undoHistory || [];
  const idx = history.findIndex((h) => String(h.id) === String(undoId));
  if (idx === -1) {
    return ctx.reply('That undo has expired or was already used.');
  }
  const undo = history[idx];
  ctx.session.undoHistory = history.filter((_, i) => i !== idx);
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    if (undo.type === 'visibility') {
      await github.setVisibility(token, user.login, undo.repoName, undo.previousValue);
      repoCache.invalidateRepos(ctx.from.id);
      await activity.log(ctx.from.id, '↩️', `Undid visibility change → ${undo.repoName}`);
    } else if (undo.type === 'description') {
      await github.updateDescription(token, user.login, undo.repoName, undo.previousValue);
      repoCache.invalidateRepos(ctx.from.id);
      await activity.log(ctx.from.id, '↩️', `Undid description change → ${undo.repoName}`);
    }
    await ctx.reply(format.successMessage('Undone — reverted to the previous value.'));
    return showRepoView(ctx, undo.repoName);
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t undo', err.message, 'You can change it back manually from Repo View.'));
  }
}

/** #1 — first tap on a repo registers a real GitHub webhook pointed at our
 * /webhook/github endpoint; subsequent taps just toggle mute (the webhook
 * itself stays registered, we just skip sending while muted, avoiding a
 * delete+recreate round trip with GitHub for something reversible locally). */
async function toggleWebhookEnable(ctx, repoName) {
  // Locked, same as every other write action here — without this, a fast
  // double-tap before the screen re-renders (the button only disappears
  // once Repo View redraws) could register two live webhooks on GitHub for
  // the same repo. Only the second's id/secret would ever get saved, so
  // the first becomes an orphan that keeps firing and failing signature
  // verification forever, with no way to clean it up from inside the bot.
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'webhookEnable', () => _toggleWebhookEnable(ctx, repoName));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _toggleWebhookEnable(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const crypto = require('crypto');
    const secret = crypto.randomBytes(24).toString('hex');
    const hook = await github.createWebhook(token, user.login, repoName, `${config.BASE_URL}/webhook/github`, secret);
    await repoWebhooks.save(ctx.from.id, repoName, hook.id, secret);
    await activity.log(ctx.from.id, '🔔', `Live alerts enabled → ${repoName}`);

    // 🤖 Automation — check Auto-Mute rules immediately against this repo,
    // same as they'd apply on the next ▶️ Run Rules Now, so a repo that
    // matches (e.g. "mute all forks") never sits un-muted just because it
    // happened to have alerts enabled between now and the next manual run.
    let mutedNote = '';
    try {
      const muteRules = require('../lib/automationMuteRules');
      const repo = await github.getRepo(token, user.login, repoName);
      const matches = await muteRules.evaluateMuteRules(ctx.from.id, repo);
      if (matches.length > 0) {
        await notificationMutes.mute(ctx.from.id, repoName);
        await activity.log(ctx.from.id, '🔕', `Auto-mute rule applied → ${repoName}`, { isAutomated: true });
        mutedNote = ' (auto-muted — matches an Auto-Mute rule)';
      }
    } catch (_) { /* non-fatal — Auto-Mute is a bonus check, not a dependency of enabling alerts */ }

    await ephemeral.sendEphemeral(ctx, format.successMessage(`Live alerts enabled for ${repoName}${mutedNote}.`));
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t enable live alerts', err.message, 'Check the bot has admin access to this repo, then try again.'));
  }
  return showRepoView(ctx, repoName);
}

async function toggleWebhookMute(ctx, repoName) {
  const muted = await notificationMutes.isMuted(ctx.from.id, repoName);
  if (muted) {
    await notificationMutes.unmute(ctx.from.id, repoName);
    await ephemeral.sendEphemeral(ctx, format.successMessage(`Unmuted — you\u2019ll get alerts for ${repoName} again.`));
  } else {
    await notificationMutes.mute(ctx.from.id, repoName);
    await ephemeral.sendEphemeral(ctx, format.successMessage(`Muted — ${repoName} won\u2019t send alerts until you unmute it.`));
  }
  return showRepoView(ctx, repoName);
}

/** #12 — dumps everything GitroHub itself knows about a repo (not a GitHub
 * data export) as a downloadable JSON file: tags, pin status, and whatever
 * local metadata exists, for backup/review purposes. */
async function exportRepoJson(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const fs = require('fs');
  const path = require('path');
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const repo = await github.getRepo(token, user.login, repoName);
    const [pinned, repoTags] = await Promise.all([
      pins.isPinned(ctx.from.id, repoName),
      tags.tagsForRepo(ctx.from.id, repoName),
    ]);
    const exportData = {
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      license: repo.license ? repo.license.spdx_id : null,
      created_at: repo.created_at,
      pushed_at: repo.pushed_at,
      gitrohub: {
        pinned,
        tags: repoTags.map((t) => ({ name: t.name, emoji: t.emoji })),
        exported_at: new Date().toISOString(),
      },
    };
    const filePath = path.join('/tmp', `${repoName}-export.json`);
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
    await ctx.replyWithDocument({ source: filePath, filename: `${repoName}-export.json` });
    fs.unlink(filePath, () => {}); // best-effort cleanup, not worth failing the export over
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t export repo data', err.message, 'Try again.'));
  }
}

/** #8 — sends the full README as a document, alongside the truncated
 * preview already shown inline (reuses browseFiles' send-as-document idea). */
async function sendFullReadme(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const fs = require('fs');
  const path = require('path');
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const file = await github.getFileContent(token, user.login, repoName, 'README.md');
    const filePath = path.join('/tmp', `${repoName}-README.md`);
    fs.writeFileSync(filePath, file.content); // file.content is a Buffer — writeFileSync accepts it directly
    await ctx.replyWithDocument({ source: filePath, filename: 'README.md' });
    fs.unlink(filePath, () => {});
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t send README', err.message, 'Try again.'));
  }
}

async function downloadRepo(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  await ctx.reply(`📦 Preparing zip of ${format.escapeMd(repoName)}\\.\\.\\.`, { parse_mode: 'MarkdownV2' });
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const repo = await github.getRepo(token, user.login, repoName);
    const buffer = await github.downloadZip(token, user.login, repoName, repo.default_branch);

    if (buffer.length > 20 * 1024 * 1024) {
      const fallbackUrl = github.zipDownloadUrl(user.login, repoName, repo.default_branch);
      return ctx.reply(format.errorMessage(
        'Download failed',
        `repo is ${format.formatBytes(buffer.length)} — exceeds Telegram's 20MB limit for bot-sent files`,
        `Here's a direct download link instead:\n${fallbackUrl}`
      ));
    }

    await ctx.replyWithDocument({ source: buffer, filename: `${repoName}.zip` });
    await activity.log(ctx.from.id, '⬇️', `Downloaded repo → ${repoName}`);
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Download failed → ${repoName}`, { detail: err.message, isError: true });
    const errorHelpers = require('../lib/errorHelpers');
    await errorHelpers.replyGithubError(ctx, err, 'Download failed');
  }
}

async function togglePin(ctx, repoName) {
  // Gated behind requireConnected — checked first, before any DB write, so
  // a stale button can't pin/unpin a repo with zero warning if the account
  // is disconnected. Check first, write second.
  const token = await requireConnected(ctx);
  if (!token) return;

  const telegramId = ctx.from.id;
  const isPinned = await pins.isPinned(telegramId, repoName);

  if (isPinned) {
    await pins.unpin(telegramId, repoName);
    await ephemeral.sendEphemeral(ctx, `📌 Unpinned — removed from ⭐ Pinned.`);
  } else {
    await pins.pin(telegramId, repoName);
    await ephemeral.sendEphemeral(ctx, `📌 Pinned — added to ⭐ Pinned for quick access.`);
  }
  // Re-render so the 📌 tag on the info card and the button label both update immediately
  return showRepoView(ctx, repoName);
}

module.exports = {
  showRepoView,
  showRepoDetails,
  showCloneUrl,
  undoAction,
  toggleWebhookEnable,
  toggleWebhookMute,
  exportRepoJson,
  sendFullReadme,
  askDeleteRepo,
  executeDeleteRepo,
  askToggleVisibility,
  executeToggleVisibility,
  askEditDescription,
  handleDescriptionInput,
  showLicenseMenu,
  executeSetLicense,
  downloadRepo,
  cleanupOrphanedData,
  togglePin,
};
