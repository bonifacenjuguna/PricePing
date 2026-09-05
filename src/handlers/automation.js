const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const format = require('../lib/format');
const config = require('../config');
const requireConnected = require('../lib/requireConnected');
const tags = require('../lib/tags');
const muteRules = require('../lib/automationMuteRules');
const ruleEngine = require('../lib/ruleEngine');
const activity = require('../lib/activity');
const ephemeral = require('../lib/ephemeral');

const STALE_DAYS = 90;

/**
 * 🤖 Automation — the parent hub for everything that acts on repos without
 * a person tapping through it manually: Defaults (starting values),
 * Auto-Tag Rules (background tagging), Auto-Mute Rules (background
 * notification muting), a 🗂️ Stale Repos nudge, and the Automation Log
 * (an audit trail of what ran on its own).
 *
 * Defaults itself is untouched — same handler, same data, same behavior —
 * just relocated one level deeper (myDefaults.showDefaults, entered via
 * the '⚙️ Defaults' BBTB button or 'automation:defaults' callback instead
 * of its own top-level BBTB button).
 */
async function showAutomationHub(ctx, { skipBbtb = false } = {}) {
  const users = require('../lib/users');
  const connected = await users.isConnected(ctx.from.id);
  if (!connected) return;

  const user = await users.getUser(ctx.from.id);
  const [userTags, muteRulesList, lastRunResult] = await Promise.all([
    tags.listTags(ctx.from.id),
    muteRules.listMuteRules(ctx.from.id),
    activity.recent(ctx.from.id, { limit: 1, automatedOnly: true }),
  ]);
  const backupRulesLib = require('../lib/automationBackupRules');
  const scheduledRepos = require('../lib/scheduledRepos');
  const [backupRulesList, scheduledPending] = await Promise.all([
    backupRulesLib.listBackupRules(ctx.from.id),
    scheduledRepos.listPending(ctx.from.id),
  ]);
  const activeRulesTotal = userTags.filter((t) => t.auto_rule_json).length + muteRulesList.length + backupRulesList.length;
  const lastRun = lastRunResult.rows[0] ? format.relativeTime(lastRunResult.rows[0].created_at) : 'never';

  const text =
    `🤖 *Automation*\n\n` +
    `Rules and background behavior that act on your repos without a manual tap every time\\.\n\n` +
    `▸ 🔧 *Rules* — ${activeRulesTotal} active rule${activeRulesTotal === 1 ? '' : 's'} across Auto\\-Tag, Auto\\-Mute, Auto\\-Backup, plus 🗂️ Stale Repos\\.\n` +
    `▸ 📅 *Schedule* — ${scheduledPending.length} repo${scheduledPending.length === 1 ? '' : 's'} queued\\. Also where 🌍 Timezone lives \\(currently *${format.escapeMd(user.timezone || 'UTC')}*\\)\\.\n` +
    `▸ ⚙️ *Defaults* — starting values for new repos, uploads, sort/filter, notifications\\.\n\n` +
    `🕐 Last rules run: ${format.escapeMd(lastRun)}`;

  if (!skipBbtb) await ephemeral.sendEphemeral(ctx, '🤖 Automation', bbtb.automation);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.automationHubActions() });
}

/** 📅 Schedule — the intermediate hub-of-hubs for Scheduled Commits and
 * Timezone. Merged into one entry point because Timezone only exists to
 * serve Scheduled Commits (interpreting/displaying its times) — they're
 * one feature area even though they're two screens. */
async function showScheduleHub(ctx, { skipBbtb = false } = {}) {
  if (!skipBbtb) await ephemeral.sendEphemeral(ctx, '📅 Schedule', bbtb.automationScheduleHub);
  await ctx.reply(
    '📅 *Schedule*\n\nDefer repo creation to a future time, in your own timezone\\.',
    { parse_mode: 'MarkdownV2', ...inline.scheduleHubMenu() }
  );
}

/** 🔧 Rules — the intermediate hub-of-hubs grouping every
 * condition-matching feature (Auto-Tag, Auto-Mute, Auto-Backup) plus the
 * one passive insight (Stale Repos) that fits the same "set a condition,
 * see matches" shape even though it doesn't act on anything by itself. */
async function showRulesHub(ctx, { skipBbtb = false } = {}) {
  if (!skipBbtb) await ephemeral.sendEphemeral(ctx, '🔧 Rules', bbtb.automationRulesHub);
  await ctx.reply(
    '🔧 *Rules & Insights*\n\nCondition\\-based automation — tag, mute, or back up repos automatically, or just see which ones need attention\\.',
    { parse_mode: 'MarkdownV2', ...inline.rulesHubMenu() }
  );
}

// ─── Auto-Tag Rules ────────────────────────────────────────────────

function parseRule(t) {
  if (!t.auto_rule_json) return null;
  try { return JSON.parse(t.auto_rule_json); } catch (_) { return null; }
}

async function showAutoTagRules(ctx) {
  const userTags = await tags.listTags(ctx.from.id);

  let text = `🏷️ *Auto\\-Tag Rules*\n\nAttach a condition to a tag and GitroHub will offer to apply it automatically whenever it matches\\. ⚡ \\= rule active, ➖ \\= none\\.\n\n`;
  if (userTags.length === 0) {
    text += `You don\u2019t have any tags yet\\. Create one first from a repo\u2019s 🏷️ Tags menu, then come back here to attach a rule to it\\.`;
  } else {
    text += userTags
      .map((t) => `${t.auto_rule_json ? '⚡' : '➖'} ${t.emoji} *${format.escapeMd(t.name)}* — ${format.escapeMd(tags.describeRule(parseRule(t)))}`)
      .join('\n');
  }

  await ephemeral.sendEphemeral(ctx, '🏷️ Auto-Tag Rules', bbtb.automationRulesSub);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.autoTagRulesMenu(userTags) });
}

async function startEditRule(ctx, tagId) {
  const userTags = await tags.listTags(ctx.from.id);
  const tag = userTags.find((t) => String(t.id) === String(tagId));
  if (!tag) {
    await ctx.reply('That tag no longer exists.');
    return showAutoTagRules(ctx);
  }
  const rule = parseRule(tag);
  await ctx.reply(
    `${tag.emoji} *${format.escapeMd(tag.name)}*\nCurrent rule: ${format.escapeMd(tags.describeRule(rule))}\n\nWhat should trigger this tag automatically?`,
    { parse_mode: 'MarkdownV2', ...inline.ruleFieldMenu(tagId, !!rule) }
  );
}

async function selectRuleField(ctx, tagId, field) {
  if (field === 'visibility') {
    await ctx.reply('Choose the visibility that should trigger this tag:', inline.ruleVisibilityMenu(tagId));
    return;
  }
  if (field === 'fork') {
    await ctx.reply('Choose whether this tag should trigger on forks or non-forks:', inline.ruleForkMenu(tagId));
    return;
  }
  ctx.session.automationRuleInput = { tagId, field };
  const prompt = field === 'language'
    ? '💻 Type the exact language name as GitHub reports it (e.g. Python, JavaScript, TypeScript).'
    : '📛 Type a name pattern, using * as a wildcard (e.g. api-*, *-service).';
  await ctx.reply(prompt, bbtb.cancelOnly);
}

async function setVisibilityRule(ctx, tagId, value) {
  await tags.setAutoRule(ctx.from.id, Number(tagId), { field: 'visibility', op: 'eq', value });
  await ephemeral.sendEphemeral(ctx, format.successMessage('Rule saved'));
  return showAutoTagRules(ctx);
}

async function setForkRule(ctx, tagId, value) {
  await tags.setAutoRule(ctx.from.id, Number(tagId), { field: 'fork', op: 'eq', value });
  await ephemeral.sendEphemeral(ctx, format.successMessage('Rule saved'));
  return showAutoTagRules(ctx);
}

/** Called from the text router (bot.js) when ctx.session.automationRuleInput is set */
async function handleRuleValueInput(ctx, text) {
  const state = ctx.session.automationRuleInput;
  delete ctx.session.automationRuleInput;
  if (!state) return;

  if (text === '❌ Cancel') {
    await ctx.reply('Cancelled.');
    return showAutoTagRules(ctx);
  }

  const value = text.trim();
  if (!value) {
    await ctx.reply('Send a value as text, or ❌ Cancel.');
    ctx.session.automationRuleInput = state; // let them retry without losing the field they picked
    return;
  }

  const rule = state.field === 'name'
    ? { field: 'name', op: 'matches', value }
    : { field: 'language', op: 'eq', value };
  await tags.setAutoRule(ctx.from.id, Number(state.tagId), rule);
  await ephemeral.sendEphemeral(ctx, format.successMessage('Rule saved'));
  return showAutoTagRules(ctx);
}

async function clearRule(ctx, tagId) {
  await tags.setAutoRule(ctx.from.id, Number(tagId), null);
  await ephemeral.sendEphemeral(ctx, '➖ Rule cleared.');
  return showAutoTagRules(ctx);
}

/** One-tap accept for the suggestion shown inline on Repo View when an
 * active rule matches a repo that doesn't have that tag yet. */
async function applySuggestedTag(ctx, repoName, tagId) {
  const userTags = await tags.listTags(ctx.from.id);
  const tag = userTags.find((t) => String(t.id) === String(tagId));
  await tags.assignTag(ctx.from.id, repoName, Number(tagId));
  await activity.log(
    ctx.from.id,
    '🏷️',
    `Auto-tag suggestion applied → ${tag ? tag.name : `tag #${tagId}`} (${repoName})`,
    { isAutomated: true }
  );
  try {
    await ctx.editMessageText(`✅ Tagged ${repoName}${tag ? ` with ${tag.emoji} ${tag.name}` : ''}.`); // suggestion card itself — not a new message, nothing to schedule
  } catch (_) {
    await ephemeral.sendEphemeral(ctx, `✅ Tagged ${repoName}.`);
  }
}

async function dismissSuggestion(ctx) {
  try {
    await ctx.editMessageText('➖ Dismissed.');
  } catch (_) { /* message too old to edit — non-fatal, it's just a suggestion */ }
}

// ─── Auto-Mute Rules ───────────────────────────────────────────────

async function showMuteRules(ctx) {
  const rules = await muteRules.listMuteRules(ctx.from.id);

  let text = `🔕 *Auto\\-Mute Rules*\n\nAutomatically mute Live Alert notifications for repos matching a condition — handy for forks or low\\-priority repos\\. Only ever affects repos that already have alerts enabled\\.\n\n`;
  if (rules.length === 0) {
    text += `No mute rules yet\\.`;
  } else {
    text += rules.map((r, i) => `${i + 1}\\. ${format.escapeMd(ruleEngine.describeRule(r))}`).join('\n');
  }

  await ephemeral.sendEphemeral(ctx, '🔕 Auto-Mute Rules', bbtb.automationRulesSub);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.muteRulesMenu(rules) });
}

async function startAddMuteRule(ctx) {
  await ctx.reply('What should trigger an automatic mute?', inline.muteRuleFieldMenu());
}

async function selectMuteRuleField(ctx, field) {
  if (field === 'visibility') {
    await ctx.reply('Choose the visibility that should trigger a mute:', inline.muteRuleVisibilityMenu());
    return;
  }
  if (field === 'fork') {
    await ctx.reply('Choose whether this should trigger on forks or non-forks:', inline.muteRuleForkMenu());
    return;
  }
  ctx.session.automationMuteRuleInput = { field };
  const prompt = field === 'language'
    ? '💻 Type the exact language name as GitHub reports it (e.g. Python, JavaScript, TypeScript).'
    : '📛 Type a name pattern, using * as a wildcard (e.g. archive-*, *-old).';
  await ctx.reply(prompt, bbtb.cancelOnly);
}

async function setMuteVisibilityRule(ctx, value) {
  await muteRules.createMuteRule(ctx.from.id, { field: 'visibility', op: 'eq', value });
  await ephemeral.sendEphemeral(ctx, format.successMessage('Mute rule added'));
  return showMuteRules(ctx);
}

async function setMuteForkRule(ctx, value) {
  await muteRules.createMuteRule(ctx.from.id, { field: 'fork', op: 'eq', value });
  await ephemeral.sendEphemeral(ctx, format.successMessage('Mute rule added'));
  return showMuteRules(ctx);
}

async function handleMuteRuleValueInput(ctx, text) {
  const state = ctx.session.automationMuteRuleInput;
  delete ctx.session.automationMuteRuleInput;
  if (!state) return;

  if (text === '❌ Cancel') {
    await ctx.reply('Cancelled.');
    return showMuteRules(ctx);
  }

  const value = text.trim();
  if (!value) {
    await ctx.reply('Send a value as text, or ❌ Cancel.');
    ctx.session.automationMuteRuleInput = state;
    return;
  }

  const rule = state.field === 'name'
    ? { field: 'name', op: 'matches', value }
    : { field: 'language', op: 'eq', value };
  await muteRules.createMuteRule(ctx.from.id, rule);
  await ephemeral.sendEphemeral(ctx, format.successMessage('Mute rule added'));
  return showMuteRules(ctx);
}

async function deleteMuteRule(ctx, ruleId) {
  await muteRules.deleteMuteRule(ctx.from.id, Number(ruleId));
  await ephemeral.sendEphemeral(ctx, '🗑 Mute rule deleted.');
  return showMuteRules(ctx);
}

// ─── Auto-Backup Rules ─────────────────────────────────────────────

async function showBackupRules(ctx) {
  const backupRules = require('../lib/automationBackupRules');
  const rules = await backupRules.listBackupRules(ctx.from.id);

  let text = `💾 *Auto\\-Backup Rules*\n\nRepos matching a condition get a zip snapshot sent here weekly, or on demand with ▶️ Backup Now\\.\n\n`;
  text += rules.length === 0
    ? `No backup rules yet\\.`
    : rules.map((r, i) => `${i + 1}\\. ${format.escapeMd(ruleEngine.describeRule(r))}`).join('\n');

  await ephemeral.sendEphemeral(ctx, '💾 Auto-Backup Rules', bbtb.automationBackupRules);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.backupRulesMenu(rules) });
}

async function startAddBackupRule(ctx) {
  await ctx.reply('What should trigger an automatic backup?', inline.backupRuleFieldMenu());
}

async function selectBackupRuleField(ctx, field) {
  if (field === 'visibility') {
    await ctx.reply('Choose the visibility that should trigger a backup:', inline.backupRuleVisibilityMenu());
    return;
  }
  if (field === 'fork') {
    await ctx.reply('Choose whether this should trigger on forks or non-forks:', inline.backupRuleForkMenu());
    return;
  }
  ctx.session.automationBackupRuleInput = { field };
  const prompt = field === 'language'
    ? '💻 Type the exact language name as GitHub reports it (e.g. Python, JavaScript, TypeScript).'
    : '📛 Type a name pattern, using * as a wildcard (e.g. important-*, core-*).';
  await ctx.reply(prompt, bbtb.cancelOnly);
}

async function setBackupVisibilityRule(ctx, value) {
  const backupRules = require('../lib/automationBackupRules');
  await backupRules.createBackupRule(ctx.from.id, { field: 'visibility', op: 'eq', value });
  await ephemeral.sendEphemeral(ctx, format.successMessage('Backup rule added'));
  return showBackupRules(ctx);
}

async function setBackupForkRule(ctx, value) {
  const backupRules = require('../lib/automationBackupRules');
  await backupRules.createBackupRule(ctx.from.id, { field: 'fork', op: 'eq', value });
  await ephemeral.sendEphemeral(ctx, format.successMessage('Backup rule added'));
  return showBackupRules(ctx);
}

async function handleBackupRuleValueInput(ctx, text) {
  const state = ctx.session.automationBackupRuleInput;
  delete ctx.session.automationBackupRuleInput;
  if (!state) return;

  if (text === '❌ Cancel') {
    await ctx.reply('Cancelled.');
    return showBackupRules(ctx);
  }

  const value = text.trim();
  if (!value) {
    await ctx.reply('Send a value as text, or ❌ Cancel.');
    ctx.session.automationBackupRuleInput = state;
    return;
  }

  const rule = state.field === 'name'
    ? { field: 'name', op: 'matches', value }
    : { field: 'language', op: 'eq', value };
  const backupRules = require('../lib/automationBackupRules');
  await backupRules.createBackupRule(ctx.from.id, rule);
  await ephemeral.sendEphemeral(ctx, format.successMessage('Backup rule added'));
  return showBackupRules(ctx);
}

async function deleteBackupRule(ctx, ruleId) {
  const backupRules = require('../lib/automationBackupRules');
  await backupRules.deleteBackupRule(ctx.from.id, Number(ruleId));
  await ephemeral.sendEphemeral(ctx, '🗑 Backup rule deleted.');
  return showBackupRules(ctx);
}

/** Zips and sends every repo matching an active backup rule, right now.
 * Deliberately separate from ▶️ Run Rules Now — downloading+sending a zip
 * per matching repo is a much heavier, slower operation than the metadata
 * writes tag/mute rules do, so it stays an explicit, separate tap. Locked
 * the same way, for the same double-tap reason. */
async function runBackupNow(ctx) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'runAutomationBackup', () => _runBackupNow(ctx));
  if (skipped) await ctx.reply('⏳ Already backing up — please wait a moment.');
}

async function _runBackupNow(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const backupRules = require('../lib/automationBackupRules');
  const rules = await backupRules.listBackupRules(ctx.from.id);
  if (rules.length === 0) {
    await ctx.reply('➖ No backup rules set up yet — add one first.');
    return showBackupRules(ctx);
  }

  const repoCache = require('../lib/repoCache');
  const github = require('../lib/github');
  const user = await repoCache.getUser(ctx.from.id, token);
  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  const matches = await backupRules.matchingRepos(ctx.from.id, allRepos);

  if (matches.length === 0) {
    await ctx.reply('➖ No repos currently match your backup rules.');
    return showBackupRules(ctx);
  }

  await ctx.reply(`💾 Backing up ${matches.length} repo(s)...`);

  let sent = 0;
  for (const repo of matches) {
    try {
      const zipBuffer = await github.downloadZip(token, user.login, repo.name, repo.default_branch);
      await ctx.replyWithDocument(
        { source: zipBuffer, filename: `${repo.name}-backup-${new Date().toISOString().slice(0, 10)}.zip` },
        { caption: `💾 ${repo.name}` }
      );
      sent++;
    } catch (err) {
      await ctx.reply(format.errorMessage(`Backup failed for ${repo.name}`, err.message, 'Continuing with the rest.'));
    }
  }

  await activity.log(ctx.from.id, '💾', `Auto-backup run → ${sent} repo(s) sent`, { isAutomated: true });
  await ctx.reply(format.successMessage(`Backed up ${sent} of ${matches.length} repo(s)`));
  return showBackupRules(ctx);
}

// ─── Run everything ────────────────────────────────────────────────

/** Applies every active Auto-Tag AND Auto-Mute rule against every repo,
 * retroactively — separate from the per-repo tag suggestion on Repo View
 * (which only checks the one repo you're looking at) and separate from the
 * live auto-mute check on 🔔 Enable Live Alerts (which only checks that one
 * repo at the moment you turn alerts on). Locked like every other
 * multi-repo write in the bot (see Bulk Actions) since it fans out across
 * the whole account in one tap. */
async function runAllRulesNow(ctx) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'runAutomationRules', () => _runAllRulesNow(ctx));
  if (skipped) await ctx.reply('⏳ Already running — please wait a moment.');
}

async function _runAllRulesNow(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const repoCache = require('../lib/repoCache');
  const repoWebhooks = require('../lib/repoWebhooks');
  const notificationMutes = require('../lib/notificationMutes');

  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  const existingByRepo = await tags.tagsForRepos(ctx.from.id, allRepos.map((r) => r.name));
  const muteRulesList = await muteRules.listMuteRules(ctx.from.id);

  await ctx.reply(`▶️ Checking ${allRepos.length} repo(s) against your automation rules...`);

  let tagsApplied = 0;
  let reposTagged = 0;
  let reposMuted = 0;

  for (const repo of allRepos) {
    // Auto-Tag
    const matches = await tags.evaluateAutoRules(ctx.from.id, repo);
    if (matches.length > 0) {
      const already = new Set((existingByRepo[repo.name] || []).map((t) => t.id));
      const newMatches = matches.filter((m) => !already.has(m.id));
      if (newMatches.length > 0) {
        for (const m of newMatches) {
          await tags.assignTag(ctx.from.id, repo.name, m.id);
          tagsApplied++;
        }
        reposTagged++;
      }
    }

    // Auto-Mute — only ever touches repos that already have alerts enabled
    if (muteRulesList.length > 0) {
      const reg = await repoWebhooks.get(ctx.from.id, repo.name).catch(() => null);
      if (reg) {
        const alreadyMuted = await notificationMutes.isMuted(ctx.from.id, repo.name).catch(() => false);
        if (!alreadyMuted && muteRulesList.some((r) => ruleEngine.matchesRule(r, repo))) {
          await notificationMutes.mute(ctx.from.id, repo.name);
          reposMuted++;
        }
      }
    }
  }

  await activity.log(
    ctx.from.id,
    '🤖',
    `Automation run → ${tagsApplied} tag(s) applied across ${reposTagged} repo(s), ${reposMuted} repo(s) muted`,
    { isAutomated: true }
  );

  const parts = [];
  if (tagsApplied > 0) parts.push(`applied ${tagsApplied} tag(s) across ${reposTagged} repo(s)`);
  if (reposMuted > 0) parts.push(`muted ${reposMuted} repo(s)`);
  await ctx.reply(parts.length > 0 ? `✅ Done — ${parts.join(', ')}.` : '➖ No new matches — everything\u2019s already up to date.');

  return showRulesHub(ctx);
}

// ─── Stale Repos ───────────────────────────────────────────────────

async function getStaleRepos(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return [];
  const repoCache = require('../lib/repoCache');
  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  return allRepos
    .filter((r) => new Date(r.pushed_at).getTime() < cutoff)
    .sort((a, b) => new Date(a.pushed_at) - new Date(b.pushed_at));
}

async function showStaleRepos(ctx) {
  const stale = await getStaleRepos(ctx);
  let text = `🗂️ *Stale Repos*\n\nNo push in ${STALE_DAYS}\\+ days — might be worth archiving, tagging, or just checking on\\.\n\n`;
  text += stale.length === 0
    ? `Nothing stale — everything\u2019s been touched recently\\.`
    : `Showing ${Math.min(stale.length, 15)} of ${stale.length}\\.`;

  const withLabels = stale.slice(0, 15).map((r) => ({ ...r, staleLabel: format.relativeTime(r.pushed_at) }));
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.staleReposMenu(withLabels) });
}

// ─── Automation Log ────────────────────────────────────────────────

async function showAutomationLog(ctx, { page = 1, edit = false } = {}) {
  const telegramId = ctx.from.id;
  const limit = config.ACTIVITY_PER_PAGE;
  const offset = (page - 1) * limit;

  const { rows, total } = await activity.recent(telegramId, { limit, offset, automatedOnly: true });
  const totalPages = Math.max(1, Math.ceil(total / limit));

  let text = `📜 *Automation Log*\n\nWhat GitroHub did on its own \\(auto\\-tag rules, auto\\-mute rules, auto\\-backup runs, applied suggestions\\) — separate from your own taps\\.\n\n`;
  if (rows.length === 0) {
    text += 'Nothing automated has run yet\\.';
  } else {
    text += rows
      .map((r) => `🕐 ${format.escapeMd(format.relativeTime(r.created_at))}   ${r.icon} ${format.escapeMd(r.summary)}`)
      .join('\n');
    text += `\n\nShowing last ${rows.length} of ${total} event${total === 1 ? '' : 's'}`;
  }

  const keyboard = inline.automationLogPagination(page, totalPages);
  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...keyboard });
  } else {
    await ephemeral.sendEphemeral(ctx, '📜 Automation Log', bbtb.backToAutomation);
    await ctx.reply(text, { parse_mode: 'MarkdownV2', ...keyboard });
  }
}

module.exports = {
  showAutomationHub,
  showRulesHub,
  showScheduleHub,
  showAutoTagRules,
  startEditRule,
  selectRuleField,
  setVisibilityRule,
  setForkRule,
  handleRuleValueInput,
  clearRule,
  applySuggestedTag,
  dismissSuggestion,
  showMuteRules,
  startAddMuteRule,
  selectMuteRuleField,
  setMuteVisibilityRule,
  setMuteForkRule,
  handleMuteRuleValueInput,
  deleteMuteRule,
  showBackupRules,
  startAddBackupRule,
  selectBackupRuleField,
  setBackupVisibilityRule,
  setBackupForkRule,
  handleBackupRuleValueInput,
  deleteBackupRule,
  runBackupNow,
  runAllRulesNow,
  showStaleRepos,
  getStaleRepos,
  showAutomationLog,
};
