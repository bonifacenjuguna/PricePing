// Menu-based equivalent of PricePing's /setcaption, /resetcaption,
// /variables, /previewcaption commands. Same engine (src/lib/templateEngine.js),
// same DB layer (src/db/templates.js) — only the entry point differs, per
// this bot's explicit no-command-sprawl rule (/start /help /settings only).
const { Markup } = require('telegraf');
const { bySymbol } = require('../coins');
const templatesDb = require('../db/templates');
const templateEngine = require('../lib/templateEngine');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit, sendEphemeral } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');
const replyKb = require('../keyboards/replyKeyboards');

const ALERT_TYPES = [
  { key: 'threshold', label: 'Threshold Alerts' },
  { key: 'milestone', label: 'Milestone Alerts' },
  { key: 'manual', label: 'Manual Posts' },
  { key: 'chart', label: 'Charts' },
];

// Sample data used for previews — BTC at a round number, enough fields
// populated to exercise every variable in every default template at once.
const SAMPLE_CTX_BY_TYPE = {
  threshold: { coin: bySymbol.get('BTC'), price: 77000, direction: 'up', changeUsd: 2200, changePct: 2.9, threshold: { type: 'pct', value: 3 } },
  milestone: { coin: bySymbol.get('BTC'), price: 78000, direction: 'up', milestoneLevel: 78000 },
  manual: { coin: bySymbol.get('ETH'), price: 3210.55, stats24h: { highPrice: 3280, lowPrice: 3150 } },
  chart: { coin: bySymbol.get('SOL'), price: 210.42, periodLabel: 'Last 24 hours (line)' },
};

async function showCaptionSettings(ctx) {
  navStack.push(ctx, 'captionSettings', {});
  const all = await templatesDb.getAll();

  const rows = ALERT_TYPES.map(({ key, label }) => {
    const isCustom = all.has(key);
    return [callback(`${isCustom ? '✏️' : '⚪'} ${label}`, `captionsettings:opentype:${key}`)];
  });
  rows.push([callback('📖 Variables Reference', 'captionsettings:variables')]);
  rows.push(navRow());

  const text = '✏️ *Captions*\n\nEach alert type has its own caption template. ✏️ = customized, ⚪ = using the default.\n\nTap one to edit, preview, or reset it.';
  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function showTypeDetail(ctx, alertType) {
  navStack.push(ctx, 'captionTypeDetail', { alertType });
  const custom = await templatesDb.get(alertType);
  const active = custom || templateEngine.DEFAULT_TEMPLATES[alertType];
  const typeLabel = ALERT_TYPES.find((t) => t.key === alertType).label;

  const text =
    `✏️ *${typeLabel}*\n\n` +
    `Current template${custom ? '' : ' (default)'}:\n` +
    `\`${active.replace(/`/g, "'")}\``;

  const rows = [
    [callback('✏️ Edit', `captionsettings:edit:${alertType}`)],
    [callback('👁 Preview', `captionsettings:preview:${alertType}`)],
  ];
  if (custom) rows.push([callback('↩️ Reset to Default', `captionsettings:reset:${alertType}`)]);
  rows.push(navRow());

  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function showVariables(ctx) {
  navStack.push(ctx, 'captionVariables', {});
  const lines = ['📖 *Available variables*\n'];
  for (const { group, vars } of templateEngine.VARIABLE_DOCS) {
    lines.push(`*${group}:*`);
    lines.push(vars.map((v) => `\`{${v}}\``).join(', '));
    lines.push('');
  }
  lines.push('_A line containing a variable that has no value for the current alert is dropped automatically — e.g. {milestone_level} only shows up on milestone alerts._');
  await safeEdit(ctx, lines.join('\n'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard([navRow()]) });
}

async function promptEdit(ctx, alertType) {
  ctx.session.awaitingCaptionTemplate = { alertType };
  const typeLabel = ALERT_TYPES.find((t) => t.key === alertType).label;
  await ctx.reply(
    `✏️ Send the new caption template for *${typeLabel}*.\n\nUse {variable} placeholders — see Variables Reference for the full list. Send ❌ Cancel to abort.`,
    { parse_mode: 'Markdown', ...replyKb.cancelOnly }
  );
}

async function applyEditInput(ctx, text) {
  const pending = ctx.session.awaitingCaptionTemplate;
  if (!pending) return false;
  delete ctx.session.awaitingCaptionTemplate;
  const { alertType } = pending;

  if (text.trim() === '❌ Cancel') {
    await ctx.reply('Cancelled.', replyKb.home);
    await showTypeDetail(ctx, alertType);
    return true;
  }

  await templatesDb.set(alertType, text);
  await ctx.reply('✅ Template updated.', replyKb.home);
  await showTypeDetail(ctx, alertType);
  return true;
}

async function resetType(ctx, alertType) {
  await templatesDb.reset(alertType);
  await sendEphemeral(ctx, '✅ Reset to default.');
  await showTypeDetail(ctx, alertType);
}

async function previewType(ctx, alertType) {
  const sample = SAMPLE_CTX_BY_TYPE[alertType];
  const rendered = await templateEngine.renderCaption(alertType, sample);
  await ctx.reply(`👁 <b>Preview</b> (sample data):\n\n${rendered}`, { parse_mode: 'HTML' });
}

module.exports = { showCaptionSettings, showTypeDetail, showVariables, promptEdit, applyEditInput, resetType, previewType, ALERT_TYPES };
