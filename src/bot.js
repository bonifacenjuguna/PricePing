const { Telegraf, Scenes, session, Markup } = require('telegraf');
const config = require('./config');
const ownerGate = require('./middleware/ownerGate');
const redisStore = require('./middleware/redisSessionStore');
const users = require('./lib/users');
const bbtb = require('./keyboards/bbtb');
const inline = require('./keyboards/inline');
const style = require('./keyboards/buttonStyle');
const confirmFlow = require('./lib/confirmFlow');

const startHandler = require('./handlers/start');
const myRepos = require('./handlers/myRepos');
const repoView = require('./handlers/repoView');
const browseFiles = require('./handlers/browseFiles');
const settings = require('./handlers/settings');
const activityLog = require('./handlers/activityLog');
const search = require('./handlers/search');
const format = require('./lib/format');
const pinned = require('./handlers/pinned');
const tags = require('./handlers/tags');
const bulkActions = require('./handlers/bulkActions');
const myDefaults = require('./handlers/myDefaults');
const automation = require('./handlers/automation');
const scheduledCommits = require('./handlers/scheduledCommits');
const timezoneHandler = require('./handlers/timezone');
const exportImport = require('./handlers/exportImport');
const trash = require('./handlers/trash');
const storageData = require('./handlers/storageData');
const accessLogScreen = require('./handlers/accessLogScreen');

const createRepoScene = require('./scenes/createRepo');
const renameRepoScene = require('./scenes/renameRepo');
const uploadFileScene = require('./scenes/uploadFile');
const editFileScene = require('./scenes/editFile');

/**
 * Text inputs that scenes must keep handling THEMSELVES rather than being
 * treated as a "leave the flow" escape — these are legitimate in-flow
 * controls, not navigation.
 */
const SCENE_INTERNAL_LABELS = new Set(['❌ Cancel', '⏭️ Skip', '⬅️ Back', '⌨️ Type Path Instead', '📍 Use Root']);

async function sendCancelledMenu(ctx) {
  const connected = await users.isConnected(ctx.from.id);
  await ctx.reply('❌ Cancelled — back to main menu.', connected ? bbtb.mainMenu : bbtb.disconnected);
}

/**
 * GLOBAL SCENE ESCAPE HATCH.
 * Registers the same navigation handlers directly on each scene so
 * /start, /cancel, and every BBTB nav button work identically whether or
 * not a wizard is currently active.
 *
 * `selfEntryLabels` excludes the specific label(s) that are how you ENTER
 * this exact scene in the first place. Without this, entering a scene via
 * a BBTB tap (e.g. "➕ New Repo") would cause Telegraf to re-process that
 * same text INSIDE the newly-entered scene — where it would immediately
 * match its own escape hatch, leave, and re-enter again, bouncing several
 * times before settling (each bounce doing real session I/O). This only
 * affects scenes entered by a BBTB label (New Repo, Upload); scenes
 * entered by inline buttons (Rename, Edit File) are unaffected, since
 * there's no re-processed text for the escape hatch to match.
 */
function attachGlobalEscapes(scene, handlerMap, onLeave, selfEntryLabels = []) {
  const excluded = new Set([...SCENE_INTERNAL_LABELS, ...selfEntryLabels]);
  const cleanup = async (ctx) => {
    if (onLeave) {
      try { onLeave(ctx); } catch (_) { /* never let cleanup itself block leaving */ }
    }
    await ctx.scene.leave();
  };
  scene.command('start', async (ctx) => {
    await cleanup(ctx);
    return startHandler.handleStart(ctx);
  });
  scene.command('cancel', async (ctx) => {
    await cleanup(ctx);
    return sendCancelledMenu(ctx);
  });
  for (const [label, handler] of Object.entries(handlerMap)) {
    if (excluded.has(label)) continue;
    scene.hears(label, async (ctx) => {
      await cleanup(ctx);
      return handler(ctx);
    });
  }
}

function createBot() {
  const bot = new Telegraf(config.BOT_TOKEN);

  bot.use(ownerGate());

  // Serializes ALL update processing — only one Telegram update is ever
  // being handled at a time. This is what caps how many simultaneous DB/
  // GitHub requests can pile up: a backlog burst after a crash-restart, or
  // just several quick taps, now gets worked through one at a time instead
  // of all at once. Zero practical downside for a single-owner bot.
  let updateQueue = Promise.resolve();
  bot.use(async (ctx, next) => {
    const previous = updateQueue;
    let release;
    updateQueue = new Promise((resolve) => { release = resolve; });
    await previous;

    // Immediate visual feedback the moment this update actually starts
    // being worked on — so a tap never just sits there with no sign
    // anything happened, even during the split-second before the real
    // reply arrives. Fire-and-forget: never blocks on this.
    ctx.sendChatAction('typing').catch(() => {});

    try {
      await next();
    } finally {
      release();
    }
  });

  bot.use(session({ store: redisStore }));

  // ─── Shared handler map: BBTB label -> handler ────────────────
  const handlerMap = {
    '📁 My Repos': (ctx) => myRepos.showMyRepos(ctx),
    '➕ New Repo': (ctx) => ctx.scene.enter('createRepo'),
    '🔍 Search Repo': async (ctx) => {
      await ctx.reply('🔍 Search for a repo:', inline.searchTypeMenu());
    },
    '⚙️ Settings': (ctx) => settings.showSettings(ctx),
    '🔗 Connect GitHub': (ctx) => startHandler.sendConnectPrompt(ctx),

    '⬆️ Back to Menu': async (ctx) => {
      ctx.session.awaitingSearch = false;
      const connected = await users.isConnected(ctx.from.id);
      await ctx.reply('📍 Main Menu', connected ? bbtb.mainMenu : bbtb.disconnected);
    },

    '🔎 Filter': (ctx) => myRepos.showFilterMenu(ctx),
    '↕️ Sort': (ctx) => myRepos.showSortMenu(ctx),
    '⭐ Pinned': (ctx) => pinned.showPinned(ctx),
    '🧹 Bulk Select': (ctx) => bulkActions.startBulkSelect(ctx),
    // Bulk Select's keyboards use a shorter '⬆️ Menu' label than the rest
    // of the bot's '⬆️ Back to Menu' (#39) — same destination, own entry
    // since bot.hears matches on exact text.
    '⬆️ Menu': async (ctx) => {
      ctx.session.awaitingSearch = false;
      const connected = await users.isConnected(ctx.from.id);
      await ctx.reply('📍 Main Menu', connected ? bbtb.mainMenu : bbtb.disconnected);
    },

    '⬅️ Back to Repos': (ctx) => myRepos.showMyRepos(ctx),

    '⬆️ Upload': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      if (!repoName) return ctx.reply('Open a repo first from 📁 My Repos.');
      const pathMemory = require('./lib/pathMemory');
      const lastPath = await pathMemory.getLastPath(ctx.from.id, repoName).catch(() => null);
      await ctx.scene.enter('uploadFile', { repoName, suggestedDir: lastPath || undefined });
    },
    '📁 Browse Files': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      if (!repoName) return ctx.reply('Open a repo first from 📁 My Repos.');
      await browseFiles.showDirectory(ctx, repoName, '');
    },
    '⬇️ Download Repo': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      if (!repoName) return ctx.reply('Open a repo first from 📁 My Repos.');
      await repoView.downloadRepo(ctx, repoName);
    },
    '🔒 Visibility': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      if (!repoName) return ctx.reply('Open a repo first from 📁 My Repos.');
      await repoView.askToggleVisibility(ctx, repoName);
    },
    '⚖️ License': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      if (!repoName) return ctx.reply('Open a repo first from 📁 My Repos.');
      await repoView.showLicenseMenu(ctx, repoName);
    },

    '🔍 Search Files': async (ctx) => {
      ctx.session.awaitingFileSearch = true;
      await ctx.reply('🔍 Type a filename or keyword to search across all files.', bbtb.cancelOnly);
    },
    '⬆️ Back to Repo': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      if (repoName) await repoView.showRepoView(ctx, repoName);
    },
    '⬆️ Upload Here': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      const dir = ctx.session.currentBrowseDir || '';
      if (!repoName) return ctx.reply('Open a repo first from 📁 My Repos.');
      await ctx.scene.enter('uploadFile', { repoName, presetDir: dir });
    },
    '🔁 Replace Folder': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      const dir = ctx.session.currentBrowseDir || '';
      if (!repoName) return ctx.reply('Open a repo first from 📁 My Repos.');
      await ctx.scene.enter('uploadFile', { repoName, presetDir: dir, mode: 'replaceFolder' });
    },

    '📜 Activity': (ctx) => activityLog.showActivity(ctx),
    '🚪 Disconnect': (ctx) => settings.askDisconnect(ctx),
    '⬆️ Back to Settings': (ctx) => settings.showSettings(ctx),
    '🤖 Automation': (ctx) => automation.showAutomationHub(ctx),
    '⬆️ Back to Automation': (ctx) => automation.showAutomationHub(ctx),
    '🔧 Rules': (ctx) => automation.showRulesHub(ctx),
    '⬆️ Back to Rules': (ctx) => automation.showRulesHub(ctx),
    '▶️ Backup Now': (ctx) => automation.runBackupNow(ctx),
    '⚙️ Defaults': (ctx) => myDefaults.showDefaults(ctx),
    '▶️ Run Rules Now': (ctx) => automation.runAllRulesNow(ctx),
    '📅 Schedule': (ctx) => automation.showScheduleHub(ctx),
    '⬆️ Back to Schedule': (ctx) => automation.showScheduleHub(ctx),
    '📦 Storage': (ctx) => storageData.showStorageData(ctx),
    // 🔄 Refresh Status and 🔑 Access Log are no longer BBTB buttons —
    // relocated to inline (see #47/#48). Their handler functions are still
    // reachable, now via the callback_query router below.

    '🔁 Search Again': async (ctx) => {
      await ctx.reply('🔍 Search for a repo:', inline.searchTypeMenu());
    },

    '📤 Upload Another': async (ctx) => {
      const repoName = ctx.session.currentRepo;
      if (repoName) await ctx.scene.enter('uploadFile', { repoName });
    },

    '✅ Done': (ctx) => bulkActions.showActionMenu(ctx),
    '◀️ Selection': (ctx) => bulkActions.startBulkSelect(ctx),
  };

  attachGlobalEscapes(createRepoScene, handlerMap, null, ['➕ New Repo']);
  attachGlobalEscapes(renameRepoScene, handlerMap);
  attachGlobalEscapes(uploadFileScene, handlerMap, uploadFileScene.releaseOnExternalLeave, ['⬆️ Upload', '⬆️ Upload Here', '🔁 Replace Folder', '📤 Upload Another']);
  attachGlobalEscapes(editFileScene, handlerMap);

  const stage = new Scenes.Stage([createRepoScene, renameRepoScene, uploadFileScene, editFileScene]);
  bot.use(stage.middleware());

  // ─── Commands ─────────────────────────────────────────────
  bot.start(startHandler.handleStart);
  bot.command('settings', (ctx) => settings.showSettings(ctx));
  bot.command('cancel', (ctx) => sendCancelledMenu(ctx));
  // Deliberately NOT added to setMyCommands (index.js) — a power-user
  // shortcut straight into the exact same Full Reset confirmation flow as
  // Settings → 📦 Storage → 🗑 Clear Data → Everything, not a second
  // reset mechanism with its own rules. Still requires typing RESET to
  // actually go through.
  bot.command('reset', (ctx) => storageData.confirmClear(ctx, 'full'));

  // ─── BBTB (Reply Keyboard) text handlers ───────────────────
  for (const [label, handler] of Object.entries(handlerMap)) {
    bot.hears(label, handler);
  }

  bot.hears('❌ Cancel', async (ctx) => {
    // Clears EVERY session-flag-driven flow, not just search — otherwise a
    // stale flag (e.g. awaitingFullReset) stays stuck after Cancel and can
    // misfire on the next unrelated message the person sends.
    ctx.session.awaitingSearch = false;
    ctx.session.awaitingPublicRepo = false;
    ctx.session.awaitingFileSearch = false;
    delete ctx.session.creatingTag;
    delete ctx.session.editingDefault;
    delete ctx.session.automationRuleInput;
    delete ctx.session.automationMuteRuleInput;
    delete ctx.session.automationBackupRuleInput;
    delete ctx.session.awaitingCustomTimezone;
    delete ctx.session.awaitingTrashRestoreName;
    delete ctx.session.awaitingFullReset;
    delete ctx.session.editingDescription;
    delete ctx.session.awaitingSettingsImport;
    delete ctx.session.pendingImport;
    await sendCancelledMenu(ctx);
  });

  // ─── Free-text input router ─────────────────────────────────
  bot.on('text', async (ctx, next) => {
    if (ctx.scene && ctx.scene.current) return next(); // scene handles its own text

    if (ctx.session.awaitingSaveViewName) return bulkActions.handleSaveViewNameInput(ctx, ctx.message.text);
    if (ctx.session.awaitingQuietHours) return settings.handleQuietHoursInput(ctx, ctx.message.text);
    if (ctx.session.creatingTag) return tags.handleCreateTagInput(ctx);
    if (ctx.session.editingDefault) return myDefaults.handleTextInput(ctx);
    if (ctx.session.automationRuleInput) return automation.handleRuleValueInput(ctx, ctx.message.text);
    if (ctx.session.automationMuteRuleInput) return automation.handleMuteRuleValueInput(ctx, ctx.message.text);
    if (ctx.session.automationBackupRuleInput) return automation.handleBackupRuleValueInput(ctx, ctx.message.text);
    if (ctx.session.awaitingCustomTimezone) return timezoneHandler.handleCustomTimezoneInput(ctx);
    if (ctx.session.awaitingTrashRestoreName) return trash.handleRestoreNameInput(ctx);
    if (ctx.session.awaitingFullReset) return storageData.handleResetConfirmationText(ctx);
    if (ctx.session.editingDescription) return repoView.handleDescriptionInput(ctx, ctx.message.text);

    if (ctx.session.awaitingSearch) {
      ctx.session.awaitingSearch = false;
      return search.handleMyReposSearchInput(ctx, ctx.message.text);
    }
    if (ctx.session.awaitingPublicRepo) {
      ctx.session.awaitingPublicRepo = false;
      return search.handlePublicRepoInput(ctx, ctx.message.text);
    }
    if (ctx.session.awaitingFileSearch) {
      ctx.session.awaitingFileSearch = false;
      return browseFiles.searchFiles(ctx, ctx.session.currentRepo, ctx.message.text);
    }
    return next();
  });

  // ─── Free-document input router ─────────────────────────────
  // Only one flow outside a Scene needs a raw document upload right now
  // (Import Settings) — this stays intentionally tiny rather than growing
  // into a second upload pipeline; anything heavier belongs in a Scene
  // like uploadFile already is.
  bot.on('document', async (ctx, next) => {
    if (ctx.scene && ctx.scene.current) return next(); // scene handles its own documents
    if (ctx.session.awaitingSettingsImport) {
      ctx.session.awaitingSettingsImport = false;
      return exportImport.handleImportFile(ctx);
    }
    return next();
  });

  // ─── Inline callback_query router ───────────────────────────
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data || '';

    // Search entry-point split (📁 My Repos vs 🌐 Public Repo)
    if (data === 'search:type:myrepos') {
      await ctx.answerCbQuery();
      ctx.session.awaitingSearch = true;
      // Recent searches as quick-tap suggestions, best-effort.
      // bot.js sits at src/bot.js, sibling to src/lib/, so the require
      // path is './lib/searchHistory'.
      const searchHistory = require('./lib/searchHistory');
      const recent = await searchHistory.recent(ctx.from.id, 5).catch(() => []);
      await ctx.reply('🔍 Type a name or keyword to fuzzy-search your repos.', bbtb.cancelOnly);
      if (recent.length) {
        const rows = recent.map((q) => [style.callback(`🕒 ${q}`, `search:recent:${q}`)]);
        rows.push([style.callback('🗑 Clear History', 'search:clearhistory')]);
        await ctx.reply('Or tap a recent search:', Markup.inlineKeyboard(rows));
      }
      return;
    }
    if (data.startsWith('search:recent:')) {
      await ctx.answerCbQuery();
      ctx.session.awaitingSearch = false;
      return search.handleMyReposSearchInput(ctx, data.split('search:recent:')[1]);
    }
    if (data === 'search:clearhistory') {
      await ctx.answerCbQuery();
      const searchHistory = require('./lib/searchHistory');
      await searchHistory.clear(ctx.from.id);
      return ctx.editMessageText('🗑 Search history cleared.');
    }
    if (data === 'search:type:public') {
      await ctx.answerCbQuery();
      ctx.session.awaitingPublicRepo = true;
      await ctx.reply('🌐 Paste a GitHub repo link (e.g. https://github.com/owner/repo).', bbtb.cancelOnly);
      return;
    }

    // Repo list / filter / sort / pagination
    if (
      data.startsWith('repo:') &&
      !data.includes(':rename:') && !data.includes(':delete:') &&
      !data.includes(':visibility:') && !data.includes(':pin:') && !data.includes(':tags:') &&
      !data.includes(':description:') && !data.includes(':license:') &&
      !data.includes(':cloneurl:') && !data.includes(':star:') &&
      !data.includes(':export:') && !data.includes(':readme:') && !data.includes(':webhook:')
    ) {
      await ctx.answerCbQuery();
      const repoName = data.split('repo:')[1];
      return repoView.showRepoView(ctx, repoName);
    }
    if (data.startsWith('repos:page:')) {
      await ctx.answerCbQuery();
      myRepos.setPage(ctx.from.id, Number(data.split(':')[2]));
      return myRepos.showMyRepos(ctx, { edit: true });
    }
    if (data === 'repos:refresh') { await ctx.answerCbQuery('🔄 Refreshed'); return myRepos.showMyRepos(ctx, { edit: true }); }
    if (data === 'repos:stats') { await ctx.answerCbQuery(); return myRepos.showStats(ctx); }
    if (data === 'repos:back') {
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      return myRepos.showMyRepos(ctx);
    }
    if (data === 'repos:langfiltermenu') {
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      return myRepos.showLanguageFilterMenu(ctx);
    }

    // Repo actions: rename / delete / visibility / pin / tags
    if (data.startsWith('repo:rename:')) {
      await ctx.answerCbQuery();
      const repoName = data.split('repo:rename:')[1];
      return ctx.scene.enter('renameRepo', { repoName });
    }
    if (data.startsWith('undo:action:')) {
      await ctx.answerCbQuery();
      return repoView.undoAction(ctx, data.split('undo:action:')[1]);
    }
    if (data.startsWith('repo:description:')) {
      await ctx.answerCbQuery();
      return repoView.askEditDescription(ctx, data.split('repo:description:')[1]);
    }
    if (data.startsWith('repo:cloneurl:')) {
      await ctx.answerCbQuery();
      return repoView.showCloneUrl(ctx, data.split('repo:cloneurl:')[1]);
    }
    if (data.startsWith('repo:export:')) {
      await ctx.answerCbQuery();
      return repoView.exportRepoJson(ctx, data.split('repo:export:')[1]);
    }
    if (data.startsWith('repo:readme:')) {
      await ctx.answerCbQuery();
      return repoView.sendFullReadme(ctx, data.split('repo:readme:')[1]);
    }
    if (data.startsWith('repo:webhook:enable:')) {
      await ctx.answerCbQuery();
      return repoView.toggleWebhookEnable(ctx, data.split('repo:webhook:enable:')[1]);
    }
    if (data.startsWith('repo:webhook:toggle:')) {
      await ctx.answerCbQuery();
      return repoView.toggleWebhookMute(ctx, data.split('repo:webhook:toggle:')[1]);
    }
    if (data.startsWith('repo:license:confirm:')) {
      await ctx.answerCbQuery();
      const parts = data.split('repo:license:confirm:')[1].split(':');
      const licenseKey = parts.pop();
      const repoName = parts.join(':');
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', '⏳ Updating license…');
      return repoView.executeSetLicense(ctx, repoName, licenseKey);
    }
    if (data.startsWith('repo:license:cancel:')) {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — license unchanged.');
    }
    if (data.startsWith('repo:delete:confirm:')) {
      await ctx.answerCbQuery();
      const repoName = data.split('repo:delete:confirm:')[1];
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', `⏳ Deleting ${repoName}…`);
      return repoView.executeDeleteRepo(ctx, repoName);
    }
    if (data.startsWith('repo:delete:cancel:')) {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — repo was not deleted.');
    }
    if (data.startsWith('repo:delete:')) {
      await ctx.answerCbQuery();
      return repoView.askDeleteRepo(ctx, data.split('repo:delete:')[1]);
    }
    if (data.startsWith('repo:visibility:confirm:')) {
      await ctx.answerCbQuery();
      const repoName = data.split('repo:visibility:confirm:')[1];
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', `⏳ Updating visibility for ${repoName}…`);
      return repoView.executeToggleVisibility(ctx, repoName);
    }
    if (data.startsWith('repo:visibility:cancel:')) {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — visibility unchanged.');
    }
    if (data.startsWith('repo:pin:')) {
      await ctx.answerCbQuery();
      return repoView.togglePin(ctx, data.split('repo:pin:')[1]);
    }
    if (data.startsWith('repo:tags:')) {
      await ctx.answerCbQuery();
      return tags.showRepoTags(ctx, data.split('repo:tags:')[1]);
    }

    // Tags flow
    if (data.startsWith('tags:add:')) {
      await ctx.answerCbQuery();
      return tags.showAddTagMenu(ctx, data.split('tags:add:')[1]);
    }
    if (data.startsWith('tags:assign:')) {
      await ctx.answerCbQuery();
      const [, , repoName, tagId] = data.split(':');
      return tags.assignExistingTag(ctx, repoName, tagId);
    }
    if (data.startsWith('tags:removemenu:')) {
      await ctx.answerCbQuery();
      return tags.showRemoveTagMenu(ctx, data.split('tags:removemenu:')[1]);
    }
    if (data.startsWith('tags:removeconfirm:')) {
      await ctx.answerCbQuery();
      const [, , repoName, tagId] = data.split(':');
      return tags.removeTag(ctx, repoName, tagId);
    }
    if (data.startsWith('tags:create:')) {
      await ctx.answerCbQuery();
      return tags.startCreateTag(ctx, data.split('tags:create:')[1]);
    }
    if (data.startsWith('tags:deletetag:')) {
      await ctx.answerCbQuery();
      const [, , tagId, repoName] = data.split(':');
      return tags.deleteTagDefinition(ctx, tagId, repoName);
    }

    // Pin reorder
    if (data.startsWith('pin:up:')) {
      await ctx.answerCbQuery();
      return pinned.movePin(ctx, data.split('pin:up:')[1], 'up');
    }
    if (data.startsWith('pin:down:')) {
      await ctx.answerCbQuery();
      return pinned.movePin(ctx, data.split('pin:down:')[1], 'down');
    }
    if (data === 'pinned:refresh') {
      await ctx.answerCbQuery();
      return pinned.showPinned(ctx, { edit: true });
    }

    // Upload entry points
    if (data.startsWith('upload:start:')) {
      await ctx.answerCbQuery();
      const repoName = data.split('upload:start:')[1];
      ctx.session.currentRepo = repoName;
      return ctx.scene.enter('uploadFile', { repoName });
    }
    if (data.startsWith('file:replace:')) {
      await ctx.answerCbQuery();
      const lockedPath = data.split('file:replace:')[1];
      return ctx.scene.enter('uploadFile', { repoName: ctx.session.currentRepo, lockedPath });
    }

    // Filter — language and tag sub-menus (checked BEFORE the generic filter: handler)
    if (data === 'filter:tagmenu') {
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      return myRepos.showTagFilterMenu(ctx);
    }
    if (data === 'filter:langmenu') {
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      return myRepos.showLanguageFilterMenu(ctx);
    }
    if (data === 'filter:langoverview') {
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      return myRepos.showLanguageOverview(ctx);
    }
    if (data.startsWith('filter:lang:')) {
      await ctx.answerCbQuery();
      const lang = data.split('filter:lang:')[1];
      myRepos.setFilter(ctx.from.id, 'language', lang);
      await ctx.editMessageText(`✅ Filtered by language: ${lang}`);
      setTimeout(() => ctx.deleteMessage().catch(() => {}), 800);
      return myRepos.showMyRepos(ctx);
    }
    if (data.startsWith('filter:tag:')) {
      await ctx.answerCbQuery();
      const tagId = data.split('filter:tag:')[1];
      myRepos.setFilter(ctx.from.id, 'tag', tagId);
      await ctx.editMessageText(`✅ Filtered by tag`);
      setTimeout(() => ctx.deleteMessage().catch(() => {}), 800);
      return myRepos.showMyRepos(ctx);
    }

    // Filter / Sort menus — these render on their OWN freshly-sent message,
    // so editing here is always safe: never a stale reference.
    if (data.startsWith('filter:') || data.startsWith('sort:')) {
      await ctx.answerCbQuery();
      if (data.startsWith('filter:')) myRepos.setFilter(ctx.from.id, data.split(':')[1]);
      else myRepos.setSort(ctx.from.id, data.split(':')[1]);

      const label = data.startsWith('filter:')
        ? `✅ Filtered: ${data.split(':')[1]}`
        : `✅ Sorted: ${data.split(':')[1]}`;
      await ctx.editMessageText(label);
      setTimeout(() => ctx.deleteMessage().catch(() => {}), 800);
      return myRepos.showMyRepos(ctx);
    }

    // File browsing
    if (data.startsWith('browse:dirpage:')) {
      await ctx.answerCbQuery();
      const rest = data.split('browse:dirpage:')[1];
      const page = Number(rest.split(':')[0]);
      const dirPath = rest.split(':').slice(1).join(':');
      return browseFiles.showDirectory(ctx, ctx.session.currentRepo, dirPath, page);
    }
    if (data.startsWith('browse:dir:')) {
      await ctx.answerCbQuery();
      return browseFiles.showDirectory(ctx, ctx.session.currentRepo, data.split('browse:dir:')[1]);
    }
    if (data.startsWith('browse:file:')) {
      await ctx.answerCbQuery();
      return browseFiles.showFileActions(ctx, ctx.session.currentRepo, data.split('browse:file:')[1]);
    }
    if (data.startsWith('browse:parent:')) {
      await ctx.answerCbQuery();
      const filePath = data.split('browse:parent:')[1];
      const parent = filePath.split('/').slice(0, -1).join('/');
      return browseFiles.showDirectory(ctx, ctx.session.currentRepo, parent);
    }
    if (data.startsWith('file:view:')) {
      await ctx.answerCbQuery();
      return browseFiles.viewFileContent(ctx, ctx.session.currentRepo, data.split('file:view:')[1]);
    }
    if (data.startsWith('file:raw:')) {
      await ctx.answerCbQuery();
      return browseFiles.sendFileAsDocument(ctx, ctx.session.currentRepo, data.split('file:raw:')[1]);
    }
    if (data.startsWith('file:edit:')) {
      await ctx.answerCbQuery();
      const filePath = data.split('file:edit:')[1];
      return ctx.scene.enter('editFile', { repoName: ctx.session.currentRepo, filePath });
    }
    if (data.startsWith('file:delete:confirm:')) {
      await ctx.answerCbQuery();
      const filePath = data.split('file:delete:confirm:')[1];
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', `⏳ Deleting ${filePath}…`);
      return browseFiles.executeDeleteFile(ctx, ctx.session.currentRepo, filePath);
    }
    if (data.startsWith('file:delete:cancel:')) {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — file was not deleted.');
    }
    if (data.startsWith('file:delete:')) {
      await ctx.answerCbQuery();
      return browseFiles.askDeleteFile(ctx, ctx.session.currentRepo, data.split('file:delete:')[1]);
    }

    // External repo (search-detected link)
    if (data === 'external:download') {
      await ctx.answerCbQuery();
      return search.downloadExternalZip(ctx);
    }
    if (data === 'external:fork') {
      await ctx.answerCbQuery();
      return search.forkExternal(ctx);
    }
    if (data === 'external:fork:confirm') {
      await ctx.answerCbQuery();
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', '⏳ Forking…');
      return search.executeForkExternal(ctx);
    }
    if (data === 'external:fork:cancel' || data === 'external:cancel') {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — nothing was forked.');
    }
    if (data === 'external:star') {
      await ctx.answerCbQuery();
      return search.toggleStar(ctx);
    }
    if (data.startsWith('search:copylink:')) {
      await ctx.answerCbQuery();
      return search.copyRepoLink(ctx, data.split('search:copylink:')[1]);
    }

    // Settings / notifications / activity
    if (data.startsWith('notif:toggle:')) {
      await ctx.answerCbQuery();
      return settings.toggleNotification(ctx, data.split('notif:toggle:')[1]);
    }
    if (data === 'notif:cyclerollup') {
      await ctx.answerCbQuery();
      return settings.cycleRollup(ctx);
    }
    if (data === 'notif:setquiet') {
      await ctx.answerCbQuery();
      return settings.promptQuietHours(ctx);
    }

    // 💾 Export/Import
    if (data === 'exportimport:export') { await ctx.answerCbQuery(); return exportImport.exportSettings(ctx); }
    if (data === 'exportimport:import') { await ctx.answerCbQuery(); return exportImport.promptImportFile(ctx); }
    if (data === 'exportimport:import:confirm') {
      await ctx.answerCbQuery();
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', '⏳ Importing…');
      return exportImport.applyImport(ctx);
    }
    if (data === 'exportimport:import:cancel') {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Import cancelled — nothing changed.');
    }
    if (data === 'settings:disconnect:confirm') {
      await ctx.answerCbQuery();
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', '⏳ Disconnecting…');
      return settings.executeDisconnect(ctx);
    }
    if (data === 'settings:disconnect:cancel') {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — still connected.');
    }
    if (data === 'settings:back') {
      await ctx.answerCbQuery();
      return settings.showSettings(ctx);
    }
    if (data.startsWith('activity:page:')) {
      await ctx.answerCbQuery();
      const [, , page, errorsOnly] = data.split(':');
      return activityLog.showActivity(ctx, { page: Number(page), errorsOnly: errorsOnly === 'true', edit: true });
    }
    if (data.startsWith('activity:filter:')) {
      await ctx.answerCbQuery();
      const errorsOnly = data.split('activity:filter:')[1] === 'true';
      return activityLog.showActivity(ctx, { page: 1, errorsOnly, edit: true });
    }
    if (data.startsWith('activity:refresh:')) {
      await ctx.answerCbQuery();
      const errorsOnly = data.split('activity:refresh:')[1] === 'true';
      return activityLog.showActivity(ctx, { page: 1, errorsOnly, skipBbtb: true });
    }
    if (data === 'activity:accesslog') {
      await ctx.answerCbQuery();
      return accessLogScreen.showAccessLog(ctx, { fromActivity: true });
    }

    // My Defaults
    if (data === 'defaults:notifications') { await ctx.answerCbQuery(); return settings.showNotifications(ctx); }
    if (data === 'defaults:visibility') { await ctx.answerCbQuery(); return myDefaults.editVisibility(ctx); }
    if (data.startsWith('defaults:setvisibility:')) { await ctx.answerCbQuery(); return myDefaults.setVisibility(ctx, data.split(':')[2]); }
    if (data === 'defaults:commit') { await ctx.answerCbQuery(); return myDefaults.startEditCommitMessage(ctx); }
    if (data === 'defaults:path') { await ctx.answerCbQuery(); return myDefaults.startEditUploadPath(ctx); }
    if (data === 'defaults:sortfilter') { await ctx.answerCbQuery(); return myDefaults.editSortFilter(ctx); }
    if (data.startsWith('defaults:setsort:')) { await ctx.answerCbQuery(); return myDefaults.setSort(ctx, data.split(':')[2]); }
    if (data.startsWith('defaults:setfilter:')) { await ctx.answerCbQuery(); return myDefaults.setFilter(ctx, data.split(':')[2]); }
    if (data === 'defaults:togglelearn') { await ctx.answerCbQuery(); return myDefaults.toggleLearn(ctx); }
    if (data === 'defaults:trashretention') { await ctx.answerCbQuery(); return myDefaults.editTrashRetention(ctx); }
    if (data.startsWith('defaults:settrash:')) { await ctx.answerCbQuery(); return myDefaults.setTrashRetention(ctx, data.split(':')[2]); }

    // 🤖 Automation
    if (data === 'automation:hub') { await ctx.answerCbQuery(); return automation.showAutomationHub(ctx); }
    if (data === 'automation:refresh') { await ctx.answerCbQuery('🔄 Refreshed'); return automation.showAutomationHub(ctx, { skipBbtb: true }); }
    if (data === 'automation:ruleshub') { await ctx.answerCbQuery(); return automation.showRulesHub(ctx); }
    if (data === 'automation:schedulehub') { await ctx.answerCbQuery(); return automation.showScheduleHub(ctx); }
    if (data === 'automation:scheduledcommits') { await ctx.answerCbQuery(); return scheduledCommits.showScheduledCommits(ctx); }
    if (data === 'automation:timezone') { await ctx.answerCbQuery(); return timezoneHandler.showTimezone(ctx); }
    if (data === 'automation:ruleshub') { await ctx.answerCbQuery(); return automation.showRulesHub(ctx); }
    if (data === 'automation:defaults') { await ctx.answerCbQuery(); return myDefaults.showDefaults(ctx); }
    if (data === 'automation:tagrules') { await ctx.answerCbQuery(); return automation.showAutoTagRules(ctx); }
    if (data === 'automation:muterules') { await ctx.answerCbQuery(); return automation.showMuteRules(ctx); }
    if (data === 'automation:stalerepos') { await ctx.answerCbQuery(); return automation.showStaleRepos(ctx); }
    if (data === 'automation:runrules') { await ctx.answerCbQuery(); return automation.runAllRulesNow(ctx); }

    if (data.startsWith('automation:rule:edit:')) { await ctx.answerCbQuery(); return automation.startEditRule(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:rule:field:')) {
      await ctx.answerCbQuery();
      const [, , , tagId, field] = data.split(':');
      return automation.selectRuleField(ctx, tagId, field);
    }
    if (data.startsWith('automation:rule:setvisibility:')) {
      await ctx.answerCbQuery();
      const [, , , tagId, value] = data.split(':');
      return automation.setVisibilityRule(ctx, tagId, value);
    }
    if (data.startsWith('automation:rule:setfork:')) {
      await ctx.answerCbQuery();
      const [, , , tagId, value] = data.split(':');
      return automation.setForkRule(ctx, tagId, value);
    }
    if (data.startsWith('automation:rule:clear:')) { await ctx.answerCbQuery(); return automation.clearRule(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:applysuggested:')) {
      await ctx.answerCbQuery();
      const rest = data.split('automation:applysuggested:')[1];
      const tagId = rest.split(':').pop();
      const repoName = rest.slice(0, rest.length - tagId.length - 1);
      return automation.applySuggestedTag(ctx, repoName, tagId);
    }
    if (data === 'automation:dismisssuggested') { await ctx.answerCbQuery(); return automation.dismissSuggestion(ctx); }

    if (data === 'automation:mute:add') { await ctx.answerCbQuery(); return automation.startAddMuteRule(ctx); }
    if (data.startsWith('automation:mute:field:')) { await ctx.answerCbQuery(); return automation.selectMuteRuleField(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:mute:setvisibility:')) { await ctx.answerCbQuery(); return automation.setMuteVisibilityRule(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:mute:setfork:')) { await ctx.answerCbQuery(); return automation.setMuteForkRule(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:mute:delete:')) { await ctx.answerCbQuery(); return automation.deleteMuteRule(ctx, data.split(':')[3]); }

    if (data === 'automation:backuprules') { await ctx.answerCbQuery(); return automation.showBackupRules(ctx); }
    if (data === 'automation:runbackup') { await ctx.answerCbQuery(); return automation.runBackupNow(ctx); }
    if (data === 'automation:backup:add') { await ctx.answerCbQuery(); return automation.startAddBackupRule(ctx); }
    if (data.startsWith('automation:backup:field:')) { await ctx.answerCbQuery(); return automation.selectBackupRuleField(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:backup:setvisibility:')) { await ctx.answerCbQuery(); return automation.setBackupVisibilityRule(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:backup:setfork:')) { await ctx.answerCbQuery(); return automation.setBackupForkRule(ctx, data.split(':')[3]); }
    if (data.startsWith('automation:backup:delete:')) { await ctx.answerCbQuery(); return automation.deleteBackupRule(ctx, data.split(':')[3]); }

    if (data === 'automation:log') { await ctx.answerCbQuery(); return automation.showAutomationLog(ctx); }
    if (data.startsWith('automation:log:page:')) {
      await ctx.answerCbQuery();
      return automation.showAutomationLog(ctx, { page: Number(data.split(':')[3]), edit: true });
    }

    // 📅 Scheduled Commits — creating one is handled entirely inside
    // scenes/createRepo.js's own wizard step (createrepo:schedule and
    // createrepo:schedulepick:* never reach this global router while that
    // scene is active, same as every other createRepo callback). Only
    // managing already-scheduled ones lives here.
    if (data.startsWith('schedcommits:cancel:')) { await ctx.answerCbQuery(); return scheduledCommits.cancelScheduled(ctx, data.split(':')[2]); }

    // 🌍 Timezone
    if (data.startsWith('timezone:set:')) { await ctx.answerCbQuery(); return timezoneHandler.setTimezone(ctx, data.split('timezone:set:')[1]); }
    if (data === 'timezone:custom') { await ctx.answerCbQuery(); return timezoneHandler.promptCustomTimezone(ctx); }
    if (data.startsWith('createrepo:learndefault:')) {
      await ctx.answerCbQuery();
      const value = data.split('createrepo:learndefault:')[1];
      if (value !== 'skip') {
        const defaultsLib = require('./lib/defaults');
        await defaultsLib.setDefault(ctx.from.id, 'default_visibility', value);
        await ctx.reply(`✅ Default visibility updated to ${value === 'private' ? '🔒 Private' : '🌐 Public'}.`);
      } else {
        await ctx.reply('👍 Kept your current default.');
      }
      return;
    }
    if (data.startsWith('createrepo:tagit:')) {
      await ctx.answerCbQuery();
      const rest = data.split('createrepo:tagit:')[1];
      if (rest === 'skip') {
        return ctx.reply('👍 Skipped.');
      }
      const [repoName, tagId] = rest.split(':');
      const tagsLib = require('./lib/tags');
      await tagsLib.assignTag(ctx.from.id, repoName, Number(tagId));
      return ctx.reply('🏷️ Tagged.');
    }

    // Storage & Data
    if (data === 'storage:clearmenu') { await ctx.answerCbQuery(); return storageData.showClearMenu(ctx); }
    if (data === 'storage:back') { await ctx.answerCbQuery(); return storageData.showStorageData(ctx); }
    if (data === 'storage:trash') { await ctx.answerCbQuery(); return trash.showTrash(ctx); }
    if (data === 'storage:exportimport') { await ctx.answerCbQuery(); return exportImport.showExportImportMenu(ctx); }
    if (data.startsWith('trash:restore:')) { await ctx.answerCbQuery(); return trash.requestRestore(ctx, data.split(':')[2]); }
    if (data.startsWith('storage:clear:')) { await ctx.answerCbQuery(); return storageData.confirmClear(ctx, data.split('storage:clear:')[1]); }
    if (data.startsWith('storage:doclear:')) {
      await ctx.answerCbQuery();
      const scope = data.split('storage:doclear:')[1];
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', '⏳ Clearing…');
      return storageData.executeClear(ctx, scope);
    }
    if (data.startsWith('storage:clearcancel:')) {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — nothing was cleared.');
    }
    if (data === 'storage:exportmenu') { await ctx.answerCbQuery(); return storageData.showExportMenu(ctx); }
    if (data.startsWith('storage:export:')) { await ctx.answerCbQuery(); return storageData.executeExport(ctx, data.split('storage:export:')[1]); }
    if (data === 'storage:cleanupmenu') { await ctx.answerCbQuery(); return storageData.showCleanupMenu(ctx); }
    if (data.startsWith('storage:retention:')) { await ctx.answerCbQuery(); return storageData.setRetention(ctx, data.split('storage:retention:')[1]); }
    if (data === 'storage:toggleautodelete') { await ctx.answerCbQuery(); return storageData.toggleAutoDelete(ctx); }

    // Access Log
    if (data === 'accesslog:togglealert') { await ctx.answerCbQuery(); return accessLogScreen.toggleAlert(ctx, true); }
    if (data === 'accesslog:backtoactivity') { await ctx.answerCbQuery(); return activityLog.showActivity(ctx, { skipBbtb: true }); }
    if (data === 'settings:refresh') { await ctx.answerCbQuery(); return settings.showSettings(ctx, { skipBbtb: true }); }

    // Bulk Repo Actions
    if (data.startsWith('bulk:toggle:')) {
      await ctx.answerCbQuery();
      return bulkActions.toggleRepo(ctx, data.split('bulk:toggle:')[1], ctx.session.bulkPage || 1);
    }
    if (data.startsWith('bulk:page:')) { await ctx.answerCbQuery(); return bulkActions.startBulkSelect(ctx, { page: Number(data.split(':')[2]), edit: true }); }
    if (data === 'bulk:selectall') { await ctx.answerCbQuery(); return bulkActions.selectAll(ctx); }
    if (data === 'bulk:invert') { await ctx.answerCbQuery(); return bulkActions.invertSelection(ctx); }
    if (data === 'bulk:selectstale') { await ctx.answerCbQuery(); return bulkActions.selectStale(ctx); }
    if (data === 'bulk:selectprivate') { await ctx.answerCbQuery(); return bulkActions.selectByVisibility(ctx, true); }
    if (data === 'bulk:selectpublic') { await ctx.answerCbQuery(); return bulkActions.selectByVisibility(ctx, false); }
    if (data === 'bulk:tagmenu') { await ctx.answerCbQuery(); return bulkActions.showTagSelectMenu(ctx); }
    if (data.startsWith('bulk:selecttag:')) { await ctx.answerCbQuery(); return bulkActions.selectByTag(ctx, data.split('bulk:selecttag:')[1]); }
    if (data === 'bulk:back') { await ctx.answerCbQuery(); return bulkActions.startBulkSelect(ctx, { page: ctx.session.bulkPage || 1, edit: true }); }
    if (data.startsWith('bulk:action:')) { await ctx.answerCbQuery(); return bulkActions.confirmAction(ctx, data.split('bulk:action:')[1]); }
    if (data === 'bulk:cancel') {
      await ctx.answerCbQuery();
      return confirmFlow.resolveConfirmation(ctx, 'cancelled', '❌ Cancelled — no changes made.');
    }
    if (data.startsWith('bulk:execute:')) {
      await ctx.answerCbQuery();
      const action = data.split('bulk:execute:')[1];
      await confirmFlow.resolveConfirmation(ctx, 'confirmed', '⏳ Working…');
      if (action === 'download') return bulkActions.executeDownloads(ctx);
      return bulkActions.execute(ctx, action);
    }
    if (data.startsWith('bulk:retryfailed:')) {
      await ctx.answerCbQuery();
      return bulkActions.retryFailed(ctx, data.split('bulk:retryfailed:')[1]);
    }
    if (data.startsWith('bulk:undo:')) {
      await ctx.answerCbQuery();
      return bulkActions.undoBulkAction(ctx, data.split('bulk:undo:')[1]);
    }
    // Composable filter builder clauses
    if (data.startsWith('bulkfilter:add:')) {
      await ctx.answerCbQuery();
      const [, , type, ...rest] = data.split(':');
      return bulkActions.addFilterClause(ctx, type, rest.join(':'));
    }
    if (data === 'bulkfilter:clear') {
      await ctx.answerCbQuery();
      bulkActions.clearFilterClauses(ctx);
      return bulkActions.startBulkSelect(ctx, { page: 1, edit: true });
    }
    if (data === 'bulkfilter:saveview') {
      await ctx.answerCbQuery();
      return bulkActions.promptSaveAsView(ctx);
    }
    // Smart Folders (saved views)
    if (data.startsWith('savedview:apply:')) {
      await ctx.answerCbQuery();
      const savedViews = require('./lib/savedViews');
      const myRepos = require('./handlers/myRepos');
      return myRepos.showMyRepos(ctx, { savedViewId: Number(data.split('savedview:apply:')[1]) });
    }
    if (data.startsWith('savedview:delete:')) {
      await ctx.answerCbQuery();
      const savedViews = require('./lib/savedViews');
      await savedViews.remove(ctx.from.id, Number(data.split('savedview:delete:')[1]));
      const myRepos = require('./handlers/myRepos');
      return myRepos.showMyRepos(ctx);
    }

    // Nothing matched — most likely a stale button from an old message
    // (e.g. a completed wizard's confirm button tapped again later).
    // Without this, the tap just leaves Telegram's loading spinner stuck
    // until it times out, which looks like the bot is broken.
    await ctx.answerCbQuery('This button has expired.');
    return;
  });

  // ─── Global error handler ────────────────────────────────────
  bot.catch(async (err, ctx) => {
    console.error('Bot error:', err);
    try {
      await ctx.reply(format.errorMessage('Something went wrong', err.message || 'unexpected error', 'Try again, or go back to the main menu.'));
    } catch (_) { /* swallow */ }
  });

  return bot;
}

module.exports = createBot;
