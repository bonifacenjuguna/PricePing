const { Scenes, Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const ephemeral = require('../lib/ephemeral');

const scene = new Scenes.WizardScene(
  'renameRepo',

  async (ctx) => {
    ctx.wizard.state.oldName = ctx.wizard.state.oldName || ctx.scene.state.repoName;
    await ctx.reply(
      `✏️ Current name: ${ctx.wizard.state.oldName}\nSend the new repo name.`,
      bbtb.cancelOnly
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (ctx.message && ctx.message.text === '❌ Cancel') {
      await ephemeral.sendEphemeral(ctx, 'Rename cancelled.', bbtb.mainMenu);
      return ctx.scene.leave();
    }
    if (!ctx.message || !ctx.message.text) {
      await ctx.reply('Send the new name as text, or ❌ Cancel.');
      return;
    }
    const newName = ctx.message.text.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(newName)) {
      await ctx.reply(format.errorMessage('Invalid repo name', `"${newName}" contains disallowed characters`, 'Use only letters, numbers, dots, hyphens, underscores.'));
      return;
    }
    ctx.wizard.state.newName = newName;

    const keyboard = Markup.inlineKeyboard([
      [style.callback('✅ Confirm Rename', 'rename:confirm', style.GREEN)],
      [style.callback('❌ Cancel', 'rename:cancel', style.RED)],
    ]);

    await ctx.reply(
      `✏️ Rename repository?\n\n${ctx.wizard.state.oldName} → ${newName}\n\n` +
      `⚠️ Old links/clones using the previous name will redirect automatically (GitHub handles this), but local git remotes you've set up elsewhere won't update on their own.`,
      keyboard
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.callbackQuery) {
      await ctx.reply('Tap ✅ Confirm Rename or ❌ Cancel above.');
      return;
    }
    await ctx.answerCbQuery();

    if (ctx.callbackQuery.data === 'rename:cancel') {
      await ephemeral.sendEphemeral(ctx, 'Rename cancelled.', bbtb.mainMenu);
      return ctx.scene.leave();
    }
    if (ctx.callbackQuery.data !== 'rename:confirm') {
      // Stray/stale callback from an unrelated old message — don't treat
      // it as a rename confirmation.
      await ctx.reply('Tap ✅ Confirm Rename or ❌ Cancel above.');
      return;
    }

    const token = await requireConnected(ctx);
    if (!token) return ctx.scene.leave();

    const { oldName, newName } = ctx.wizard.state;
    const actionLock = require('../lib/actionLock');
    const { skipped } = await actionLock.withLock(ctx.from.id, 'renameRepo', async () => {
    try {
      const user = await repoCache.getUser(ctx.from.id, token);
      const repo = await github.renameRepo(token, user.login, oldName, newName);
      repoCache.invalidateRepos(ctx.from.id);
      repoCache.invalidateLanguages(ctx.from.id, oldName);
      repoCache.invalidateTreeStats(ctx.from.id, oldName);
      // If the repo just renamed was the one "open" in Repo View, keep
      // session state pointing at it under its new name — otherwise every
      // BBTB action that reads ctx.session.currentRepo (Upload, Browse
      // Files, Download, Visibility, License, ...) would keep targeting a
      // name that no longer exists until the person reopens it manually.
      if (ctx.session.currentRepo === oldName) ctx.session.currentRepo = repo.name;
      // Keeps tags/pins/path-memory/mutes/webhooks bound to the repo
      // through the rename instead of staying keyed to the old name —
      // see renameCascade.js.
      try {
        const renameCascade = require('../lib/renameCascade');
        await renameCascade.cascadeRename(ctx.from.id, oldName, newName);
      } catch (cascadeErr) {
        // GitHub's side already succeeded — never fail the whole rename over
        // this, but make sure it's loud in the logs and in Activity.
        await activity.log(ctx.from.id, '⚠️', `Rename cascade incomplete → ${oldName} → ${newName}`, { detail: cascadeErr.message, isError: true });
      }
      await activity.log(ctx.from.id, '✏️', `Renamed → ${oldName} → ${newName}`);
      await ctx.reply(`✅ Renamed: ${oldName} → ${repo.name}\n🔗 ${repo.html_url}`, bbtb.mainMenu);
    } catch (err) {
      await activity.log(ctx.from.id, '⚠️', `Rename failed → ${oldName}`, { detail: err.message, isError: true });
      const errorHelpers = require('../lib/errorHelpers');
      if (errorHelpers.isAuthError(err)) {
        await errorHelpers.replyGithubError(ctx, err, 'Rename failed');
      } else {
        const reason = err.status === 422
          ? `"${newName}" is already taken by another repo on your account`
          : err.message;
        await ctx.reply(format.errorMessage('Rename failed', reason, 'Choose a different name.'), bbtb.mainMenu);
      }
    }
    });
    if (skipped) await ctx.reply('⏳ Already renaming — please wait a moment.');
    return ctx.scene.leave();
  }
);

module.exports = scene;
