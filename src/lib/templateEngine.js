// Caption template engine — ported from PricePing's src/services/templateEngine.js.
// Same rendering logic, same default template shape, same per-symbol
// override lookup order, adapted to our data shapes (coins.js entries,
// marketData.js results) and to HTML formatting (PricePing also uses HTML).
//
// The one deliberate departure from PricePing: editing templates happens
// through a menu screen (see handlers/captionSettings.js), not slash
// commands (/setcaption, /resetcaption, /variables) — this bot's rule,
// set explicitly earlier, is /start /help /settings only, everything else
// via menus. The engine itself — render(), buildVariables(), the line-drop
// behavior, the override lookup order — is otherwise unchanged.
const format = require('./format');
const botInfo = require('./botInfo');
const templatesDb = require('../db/templates');
const customVarsDb = require('../db/customVars');

// A colon reads as "label: value" (Name: price) — clearer than an em dash
// between two unrelated-looking chunks of text. Same defaults as PricePing.
const DEFAULT_TEMPLATES = {
  threshold: '<b>{name}</b>: ${price}\u00A0{channel_handle}',
  milestone: '<b>{name}</b>: ${price}\u00A0{channel_handle}',
  manual: '<b>{name}</b>: ${price}\u00A0{channel_handle}',
  chart: '<b>{name}</b>: {period_label}\u00A0{channel_handle}',
};

// Documentation shown by the Variables screen — grouped by where each one
// is actually populated, since e.g. {milestone_level} is only ever
// non-empty on a milestone alert.
const VARIABLE_DOCS = [
  { group: 'Always available', vars: ['symbol', 'name', 'price', 'time', 'date', 'channel_name', 'channel_handle', 'bot_name'] },
  { group: 'Threshold alerts', vars: ['direction_arrow', 'change_pct', 'change_usd', 'threshold_value', 'threshold_type', 'cooldown_remaining'] },
  { group: 'Milestone alerts', vars: ['direction_arrow', 'milestone_level', 'next_milestone'] },
  { group: 'Manual posts', vars: ['direction_arrow', 'change_pct', 'high_24h', 'low_24h'] },
  { group: 'Charts', vars: ['period_label'] },
];

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Renders a template against a variable map. Any {var} whose value is null
// or undefined causes the WHOLE LINE containing it to be dropped — this is
// what makes the defaults automatically skip a % row for stablecoins, the
// milestone row on non-milestone alerts, etc, with no conditional syntax
// for the admin to learn. {var} names not present in the map at all are
// left untouched so a typo is visible in the preview rather than silently
// vanishing.
function render(template, vars) {
  const lines = template.split('\n');
  const kept = [];

  for (const line of lines) {
    const tokens = [...line.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
    const knownTokensOnLine = tokens.filter((t) => Object.prototype.hasOwnProperty.call(vars, t));
    const hasNullKnownToken = knownTokensOnLine.some((t) => vars[t] === null || vars[t] === undefined);
    if (tokens.length && knownTokensOnLine.length && hasNullKnownToken) continue; // eslint-disable-line no-continue

    const rendered = line.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return match; // leave {typo} visible
      const value = vars[name];
      return value === null || value === undefined ? '' : escapeHtml(String(value));
    });
    kept.push(rendered);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// channel: { chat_handle, title } | null/undefined (DM/preview context)
function channelHandle(channel) {
  if (channel && channel.chat_handle) return `@${channel.chat_handle}`;
  const botHandle = botInfo.get();
  return botHandle ? `@${botHandle}` : null;
}

function formatMinutes(ms) {
  const minutes = Math.max(Math.round(ms / 60000), 0);
  return `${minutes}m`;
}

function nextMilestone(price, step) {
  if (!Number.isFinite(price) || !step) return null;
  return (Math.floor(price / step) + 1) * step;
}

// Builds the full variable map for one send. Every field in `ctx` is
// optional — anything not relevant to this alert type is simply left out
// (renders as null, triggering the line-drop behavior above).
//
// ctx: { coin, price, changeUsd, changePct, direction, alertType,
//        milestoneLevel, threshold: {type,value}, stats24h, periodLabel,
//        channel, cooldownRemainingMs }
function buildVariables(ctx) {
  const { coin } = ctx;
  const now = new Date();

  return {
    symbol: coin.symbol,
    name: coin.name,
    price: format.formatPrice(ctx.price),
    time: now.toISOString().slice(11, 16) + ' UTC',
    date: now.toISOString().slice(0, 10),
    channel_name: ctx.channel ? ctx.channel.title : null,
    channel_handle: channelHandle(ctx.channel),
    bot_name: botInfo.get() || null,

    direction_arrow: ctx.direction ? format.directionSymbol(ctx.direction) : null,
    change_pct: ctx.changePct === null || ctx.changePct === undefined ? null : format.formatPct(ctx.changePct).replace('%', ''),
    change_usd: ctx.changeUsd === null || ctx.changeUsd === undefined ? null : format.formatPrice(Math.abs(ctx.changeUsd)),
    threshold_value:
      ctx.threshold && ctx.threshold.value !== undefined
        ? ctx.threshold.type === 'pct' ? String(ctx.threshold.value) : format.formatPrice(ctx.threshold.value)
        : null,
    threshold_type: ctx.threshold ? ctx.threshold.type : null,
    cooldown_remaining: ctx.cooldownRemainingMs !== undefined ? formatMinutes(ctx.cooldownRemainingMs) : null,

    milestone_level: ctx.milestoneLevel !== undefined && ctx.milestoneLevel !== null ? format.formatPrice(ctx.milestoneLevel) : null,
    next_milestone: coin.milestoneStep ? format.formatPrice(nextMilestone(ctx.price, coin.milestoneStep)) : null,

    high_24h: ctx.stats24h ? format.formatPrice(ctx.stats24h.highPrice) : null,
    low_24h: ctx.stats24h ? format.formatPrice(ctx.stats24h.lowPrice) : null,

    period_label: ctx.periodLabel || null,
  };
}

// Custom vars never shadow a built-in name — avoids a surprising
// redefinition of e.g. {price}.
function applyCustomVarsWithoutOverride(customVars, baseVars) {
  const merged = {};
  for (const [name, value] of Object.entries(customVars)) {
    if (!Object.prototype.hasOwnProperty.call(baseVars, name)) merged[name] = value;
  }
  return merged;
}

// Looks up a symbol-specific override first (key "type:SYMBOL"), then the
// type-wide custom template, then the built-in default — same order as
// PricePing.
async function renderCaption(alertType, ctx) {
  const symbol = ctx.coin && ctx.coin.symbol;
  let template = null;
  if (symbol) template = await templatesDb.get(`${alertType}:${symbol}`);
  if (!template) template = await templatesDb.get(alertType);
  if (!template) template = DEFAULT_TEMPLATES[alertType] || DEFAULT_TEMPLATES.threshold;

  const customVars = await customVarsDb.getAll();
  const baseVars = buildVariables(ctx);
  const vars = { ...baseVars, ...applyCustomVarsWithoutOverride(customVars, baseVars) };
  return render(template, vars);
}

module.exports = {
  DEFAULT_TEMPLATES,
  VARIABLE_DOCS,
  render,
  buildVariables,
  renderCaption,
  channelHandle,
};
