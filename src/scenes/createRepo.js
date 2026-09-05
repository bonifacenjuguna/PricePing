const { Scenes, Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const ephemeral = require('../lib/ephemeral');

const cancelConfirmKeyboard = Markup.inlineKeyboard([
  [style.callback('✅ Yes, Cancel', 'createrepo:cancel:confirm', style.RED)],
  [style.callback('⬅️ No, Go Back', 'createrepo:cancel:abort', style.GREEN)],
]);

const scene = new Scenes.WizardScene(
  'createRepo',

  // Step 0 — ask name
  async (ctx) => {
    ctx.wizard.state.data = {};
    await ephemeral.sendEphemeral(ctx, '📦 Let\u2019s create a new repo.\nSend me the repository name.', bbtb.cancelOnly);
    return ctx.wizard.next();
  },

  // Step 1 — receive name, ask visibility
  async (ctx) => {
    if (await handleGlobalActions(ctx)) return;
    if (!ctx.message || !ctx.message.text) {
      await ctx.reply('Send the repository name as text, or ❌ Cancel.');
      return;
    }
    const name = ctx.message.text.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      await ctx.reply(format.errorMessage(
        'Invalid repo name',
        `"${name}" contains characters GitHub doesn\u2019t allow`,
        'Use only letters, numbers, dots, hyphens, and underscores.'
      ));
      return;
    }
    ctx.wizard.state.data.name = name;
    await ephemeral.sendEphemeral(ctx, '📦 New Repo — Step 2 of 5', bbtb.cancelWithBack);

    const defaultsLib = require('../lib/defaults');
    const d = await defaultsLib.getDefaults(ctx.from.id);
    const defaultVis = d ? d.default_visibility : 'private';
    const keyboard = Markup.inlineKeyboard([
      [style.callback(defaultVis === 'private' ? '🔒 Private ✓ default' : '🔒 Private', 'create:visibility:private')],
      [style.callback(defaultVis === 'public' ? '🌐 Public ✓ default' : '🌐 Public', 'create:visibility:public')],
    ]);
    await ctx.reply(`Repo name: ${name} ✅\nChoose visibility:`, keyboard);
    return ctx.wizard.next();
  },

  // Step 2 — receive visibility (via callback), ask description
  async (ctx) => {
    if (await handleGlobalActions(ctx)) return;
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('create:visibility:')) {
      const isPrivate = ctx.callbackQuery.data.endsWith('private');
      ctx.wizard.state.data.isPrivate = isPrivate;
      await ctx.answerCbQuery();
      await ephemeral.sendEphemeral(ctx, 'Add a short description, or skip.', bbtb.cancelWithSkip);
      return ctx.wizard.next();
    }
    await ctx.reply('Tap 🔒 Private or 🌐 Public above.');
  },

  // Step 3 — receive description (or skip), ask README
  async (ctx) => {
    if (await handleGlobalActions(ctx)) return;
    if (ctx.message && ctx.message.text === '⏭️ Skip') {
      ctx.wizard.state.data.description = '';
    } else if (ctx.message && ctx.message.text) {
      ctx.wizard.state.data.description = ctx.message.text.trim();
    } else {
      await ctx.reply('Send a description, tap ⏭️ Skip, or ❌ Cancel.');
      return;
    }

    await ephemeral.sendEphemeral(ctx, '📦 New Repo — Step 4 of 5', bbtb.cancelWithBack);
    await ctx.reply(
      '📄 Include a default README.md?',
      Markup.inlineKeyboard([
        [style.callback('✅ Yes', 'create:readme:yes')],
        [style.callback('⏭️ Skip', 'create:readme:no')],
      ])
    );
    return ctx.wizard.next();
  },

  // Step 4 — receive README choice, ask license
  async (ctx) => {
    if (await handleGlobalActions(ctx)) return;
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('create:readme:')) {
      ctx.wizard.state.data.includeReadme = ctx.callbackQuery.data.endsWith('yes');
      await ctx.answerCbQuery();
      await ephemeral.sendEphemeral(ctx, '📦 New Repo — Step 5 of 5', bbtb.cancelWithBack);
      await ctx.reply(
        '⚖️ Choose a license (or skip for none):',
        Markup.inlineKeyboard([
          [style.callback('MIT', 'create:license:mit')],
          [style.callback('Apache 2.0', 'create:license:apache-2.0')],
          [style.callback('GPL v3', 'create:license:gpl-3.0')],
          [style.callback('BSD', 'create:license:bsd-3-clause')],
          [style.callback('⏭️ Skip', 'create:license:none')],
        ])
      );
      return ctx.wizard.next();
    }
    await ctx.reply('Tap ✅ Yes or ⏭️ Skip above.');
  },

  // Step 5 — receive license choice, show confirm
  async (ctx) => {
    if (await handleGlobalActions(ctx)) return;
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('create:license:')) {
      const licenseKey = ctx.callbackQuery.data.split('create:license:')[1];
      ctx.wizard.state.data.licenseTemplate = licenseKey === 'none' ? null : licenseKey;
      await ctx.answerCbQuery();

      const { name, isPrivate, description, includeReadme, licenseTemplate } = ctx.wizard.state.data;
      const LICENSE_LABELS = { mit: 'MIT', 'apache-2.0': 'Apache 2.0', 'gpl-3.0': 'GPL v3', 'bsd-3-clause': 'BSD' };
      let text = `📦 ${name}\n${isPrivate ? '🔒 Private' : '🌐 Public'}`;
      if (description) text += `\n"${description}"`;
      text += `\n📄 README: ${includeReadme ? 'Yes' : 'Skip'}`;
      text += `\n⚖️ License: ${licenseTemplate ? LICENSE_LABELS[licenseTemplate] : 'None'}`;
      text += '\n\nReady to create this repository?';

      await ephemeral.sendEphemeral(ctx, '📦 New Repo — Confirm', bbtb.cancelWithBack);
      await ctx.reply(text, inline.createRepoConfirm);
      return ctx.wizard.next();
    }
    await ctx.reply('Tap a license option above.');
  },

  // Step 6 — confirm and create (or schedule for later)
  async (ctx) => {
    if (await handleGlobalActions(ctx)) return;

    // 📅 Scheduled Commits — awaiting a custom date/time after "⌨️ Custom".
    // Handled inside this same step (not a new wizard step) so nothing
    // downstream needs re-indexing.
    if (ctx.wizard.state.awaitingScheduleTime) {
      if (ctx.message && ctx.message.text === '❌ Cancel') {
        delete ctx.wizard.state.awaitingScheduleTime;
        await ephemeral.sendEphemeral(ctx, 'Scheduling cancelled — repo was not created.', bbtb.mainMenu);
        return ctx.scene.leave();
      }
      if (!ctx.message || !ctx.message.text) {
        await ctx.reply('Send the date and time as text, or ❌ Cancel.');
        return;
      }
      const match = ctx.message.text.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/);
      if (!match) {
        await ctx.reply(format.errorMessage('Couldn\u2019t read that', 'expected format is YYYY-MM-DD HH:MM', 'Example: 2026-09-15 14:00'));
        return;
      }
      const [, dateStr, hh, mm] = match;
      const timeStr = `${hh.padStart(2, '0')}:${mm}`;
      const users = require('../lib/users');
      const timezone = require('../lib/timezone');
      const user = await users.getUser(ctx.from.id);
      const tz = user.timezone || 'UTC';
      const scheduledFor = timezone.zonedTimeToUtc(dateStr, timeStr, tz);
      if (scheduledFor.getTime() <= Date.now()) {
        await ctx.reply(format.errorMessage('That time has already passed', `${dateStr} ${timeStr} (${tz}) is in the past`, 'Send a future date/time, or ❌ Cancel.'));
        return;
      }
      delete ctx.wizard.state.awaitingScheduleTime;
      return finalizeSchedule(ctx, scheduledFor, tz);
    }

    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('createrepo:schedulepick:')) {
      await ctx.answerCbQuery();
      const pick = ctx.callbackQuery.data.split('createrepo:schedulepick:')[1];
      if (pick === 'custom') {
        const users = require('../lib/users');
        const user = await users.getUser(ctx.from.id);
        await ctx.reply(
          `⌨️ Send the date and time as YYYY-MM-DD HH:MM, in your timezone (${user.timezone || 'UTC'} — change it in 🤖 Automation → 🌍 Timezone).\nExample: 2026-09-15 14:00`,
          bbtb.cancelOnly
        );
        ctx.wizard.state.awaitingScheduleTime = true;
        return;
      }
      const now = new Date();
      let scheduledFor;
      if (pick === '1h') scheduledFor = new Date(now.getTime() + 60 * 60 * 1000);
      else if (pick === '3days') scheduledFor = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      else if (pick === 'tomorrow9am') {
        const users = require('../lib/users');
        const timezone = require('../lib/timezone');
        const user = await users.getUser(ctx.from.id);
        const tz = user.timezone || 'UTC';
        // "Tomorrow" has to mean tomorrow in the person's own calendar, not
        // UTC's — near the date line those disagree by a full day (e.g. at
        // 23:00 UTC, someone in UTC+13 is already living in "tomorrow").
        const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        const [ty, tm, td] = todayLocal.split('-').map(Number);
        const tomorrowLocal = new Date(Date.UTC(ty, tm - 1, td + 1)); // Date normalizes month/day overflow automatically
        const y = tomorrowLocal.getUTCFullYear();
        const mo = String(tomorrowLocal.getUTCMonth() + 1).padStart(2, '0');
        const d = String(tomorrowLocal.getUTCDate()).padStart(2, '0');
        scheduledFor = timezone.zonedTimeToUtc(`${y}-${mo}-${d}`, '09:00', tz);
        if (scheduledFor.getTime() <= now.getTime()) scheduledFor = new Date(scheduledFor.getTime() + 24 * 60 * 60 * 1000);
      }
      const users = require('../lib/users');
      const user = await users.getUser(ctx.from.id);
      return finalizeSchedule(ctx, scheduledFor, user.timezone || 'UTC');
    }

    if (ctx.callbackQuery && ctx.callbackQuery.data === 'createrepo:schedule') {
      await ctx.answerCbQuery();
      await ctx.reply(
        '📅 When should this repo be created?',
        Markup.inlineKeyboard([
          [style.callback('⏱ In 1 hour', 'createrepo:schedulepick:1h')],
          [style.callback('🌅 Tomorrow 9am', 'createrepo:schedulepick:tomorrow9am')],
          [style.callback('📆 In 3 days', 'createrepo:schedulepick:3days')],
          [style.callback('⌨️ Custom date/time', 'createrepo:schedulepick:custom')],
        ])
      );
      return;
    }

    if (!ctx.callbackQuery || ctx.callbackQuery.data !== 'create:confirm') {
      await ctx.reply('Tap ✅ Create Now, 📅 Schedule for Later, or ❌ Cancel above.');
      return;
    }
    await ctx.answerCbQuery();

    const token = await requireConnected(ctx);
    if (!token) return ctx.scene.leave();

    const { name, isPrivate, description, includeReadme, licenseTemplate } = ctx.wizard.state.data;
    const actionLock = require('../lib/actionLock');
    const { skipped } = await actionLock.withLock(ctx.from.id, 'createRepo', async () => {
    try {
      const repo = await github.createRepo(token, { name, isPrivate, description, licenseTemplate });
      const repoCache = require('../lib/repoCache');
      repoCache.invalidateRepos(ctx.from.id);

      // auto_init always creates README.md (needed to guarantee a default
      // branch exists for every other feature — Browse Files, Upload, etc.
      // all assume one). If the person chose to skip README, remove that
      // one file right after creation instead of ever creating the repo
      // without a branch.
      if (!includeReadme) {
        try {
          const existing = await github.getFileContent(token, repo.owner.login, repo.name, 'README.md');
          await github.deleteFile(token, repo.owner.login, repo.name, 'README.md', existing.sha, 'Remove default README');
        } catch (_) { /* best-effort — if this fails, an unwanted README is a minor issue, not worth failing repo creation over */ }
      }

      await activity.log(ctx.from.id, '➕', `Created repo → ${name}`, {
        detail: `visibility:${isPrivate ? 'private' : 'public'}`,
      });
      await ephemeral.sendEphemeral(ctx, '📍 Main Menu', bbtb.mainMenu);
      await ctx.reply(
        `✅ Repo created: ${repo.name}\n🔗 ${repo.html_url}`,
        inline.createRepoSuccess(repo.name)
      );

      // #9 — default tag suggestion, based on the visibility/license just
      // picked in this same flow. Only suggests a tag that already exists
      // with a matching name — never auto-creates one without the person's
      // consent, and never guesses if nothing matches.
      try {
        const tagsLib = require('../lib/tags');
        const userTags = await tagsLib.listTags(ctx.from.id);
        const candidateNames = isPrivate && !licenseTemplate
          ? ['personal', 'private']
          : (!isPrivate && licenseTemplate ? ['open-source', 'public'] : []);
        const match = userTags.find((t) => candidateNames.includes(t.name.toLowerCase()));
        if (match) {
          await ctx.reply(
            `🏷️ Tag this as ${match.emoji} *${format.escapeMd(match.name)}*?`,
            { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard([
              [style.callback(`✅ Yes, Tag It`, `createrepo:tagit:${repo.name}:${match.id}`)],
              [style.callback('➖ Skip', 'createrepo:tagit:skip')],
            ]) }
          );
        }
      } catch (_) { /* best-effort, never blocks the main success flow */ }

      // "Learn from me" — if your last 3 repos all chose the same visibility
      // and it doesn't match your saved default, offer to update the default.
      const defaults = require('../lib/defaults');
      const suggestion = await defaults.checkVisibilityPattern(ctx.from.id);
      if (suggestion) {
        const label = suggestion === 'private' ? '🔒 Private' : '🌐 Public';
        await ctx.reply(
          `💡 You've chosen ${label} the last 3 times, even though your saved default is different. Update your default to ${label}?`,
          Markup.inlineKeyboard([
            [style.callback('✅ Yes, Update Default', `createrepo:learndefault:${suggestion}`, style.BLUE)],
            [style.callback('➖ Keep as is', 'createrepo:learndefault:skip')],
          ])
        );
      }
    } catch (err) {
      await activity.log(ctx.from.id, '⚠️', `Create repo failed → ${name}`, { detail: err.message, isError: true });
      const errorHelpers = require('../lib/errorHelpers');
      if (errorHelpers.isAuthError(err)) {
        await errorHelpers.replyGithubError(ctx, err, 'Couldn\u2019t create repo');
      } else {
        const reason = err.status === 422
          ? `GitHub says "${name}" already exists on your account`
          : err.message;
        await ctx.reply(format.errorMessage('Couldn\u2019t create repo', reason, 'Choose a different name and try again.'), bbtb.mainMenu);
      }
    }
    });
    if (skipped) await ctx.reply('⏳ Already creating — please wait a moment.');
    return ctx.scene.leave();
  }
);

/** 📅 Scheduled Commits — stores the fully-collected repo config for the
 * scheduler in index.js to actually create later, instead of calling
 * github.createRepo() now. Same wizard, same data, just a different final
 * action than "✅ Create Now" takes. */
async function finalizeSchedule(ctx, scheduledFor, tz) {
  const { name, isPrivate, description, includeReadme, licenseTemplate } = ctx.wizard.state.data;
  const scheduledRepos = require('../lib/scheduledRepos');
  await scheduledRepos.create(ctx.from.id, {
    name,
    description: description || null,
    visibility: isPrivate ? 'private' : 'public',
    license: licenseTemplate || null,
    includeReadme,
    scheduledFor,
  });

  const timezone = require('../lib/timezone');
  await ctx.reply(
    `📅 Scheduled: ${name} will be created ${timezone.formatInZone(scheduledFor, tz)} (${tz}).\n\n` +
    `Manage it anytime in 🤖 Automation → 📅 Scheduled Commits.`,
    bbtb.mainMenu
  );
  return ctx.scene.leave();
}

/**
 * Shared Back/Cancel handling across every step, per the standing rule:
 * ⬅️ Back steps back one step (data preserved) · ❌ Cancel needs confirming.
 * Returns true if it handled the update (caller should stop processing).
 */
async function handleGlobalActions(ctx) {  if (ctx.message && ctx.message.text === '❌ Cancel') {
    await ctx.reply('⚠️ Cancel this repo creation? Everything entered so far will be discarded.', cancelConfirmKeyboard);
    return true;
  }
  if (ctx.message && ctx.message.text === '⬅️ Back') {
    ctx.wizard.selectStep(Math.max(0, ctx.wizard.cursor - 1));
    await ctx.reply('⬅️ Going back...');
    // Re-run the previous step's prompt by simulating no-op; simplest is to
    // instruct the user, since Telegraf wizard doesn't auto re-render.
    return true;
  }
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'createrepo:cancel:confirm') {
    await ctx.answerCbQuery();
    await ephemeral.sendEphemeral(ctx, 'Repo creation cancelled.', bbtb.mainMenu);
    await ctx.scene.leave();
    return true;
  }
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'createrepo:cancel:abort') {
    await ctx.answerCbQuery();
    await ctx.reply('Continuing where you left off.');
    return true;
  }
  return false;
}

module.exports = scene;
