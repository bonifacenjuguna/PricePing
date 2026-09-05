const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const scheduledRepos = require('../lib/scheduledRepos');
const timezone = require('../lib/timezone');

/**
 * 📅 Scheduled Commits — the view/manage side of the feature; the actual
 * scheduling happens inline in scenes/createRepo.js's confirm step ("📅
 * Schedule for Later" alongside "✅ Create Now"), and execution happens in
 * index.js's poller. This screen is just "what's queued, and let me cancel
 * one" — creating a *new* one always starts from ➕ Create Repo.
 */
async function showScheduledCommits(ctx) {
  const users = require('../lib/users');
const ephemeral = require('../lib/ephemeral');
  const user = await users.getUser(ctx.from.id);
  const tz = user.timezone || 'UTC';
  const pending = await scheduledRepos.listPending(ctx.from.id);

  let text = `📅 *Scheduled Commits*\n\nRepos queued to be created at a future time — times shown in your timezone \\(${format.escapeMd(tz)}\\)\\.\n\n`;
  text += pending.length === 0
    ? `Nothing scheduled yet\\. Start one from ➕ Create Repo → 📅 Schedule for Later\\.`
    : pending.map((p, i) => `${i + 1}\\. *${format.escapeMd(p.name)}* — ${format.escapeMd(timezone.formatInZone(new Date(p.scheduled_for), tz))}`).join('\n');

  const rows = pending.map((p) => [style.callback(`❌ Cancel: ${p.name}`, `schedcommits:cancel:${p.id}`)]);
  rows.push([style.callback('⬅️ Back', 'automation:schedulehub', style.BLUE)]);

  await ephemeral.sendEphemeral(ctx, '📅 Scheduled Commits', bbtb.automationScheduleSub);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function cancelScheduled(ctx, id) {
  await scheduledRepos.cancel(ctx.from.id, Number(id));
  await ctx.reply('❌ Scheduled repo cancelled — nothing will be created.');
  return showScheduledCommits(ctx);
}

module.exports = { showScheduledCommits, cancelScheduled };
