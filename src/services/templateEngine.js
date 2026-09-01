const config = require('../config');
const format = require('../utils/format');
const templatesDb = require('../db/templates');
const customVarsDb = require('../db/customVars');

// Built-in templates — used whenever the admin hasn't set a custom one for
// that alert type (see /setcaption, /resetcaption). Written using only
// variables documented in VARIABLE_DOCS below, so "what would the default
// look like" and "what variables exist" always stay in sync.
const DEFAULT_TEMPLATES = {
  threshold: '<b>{name}</b> ({symbol}) \u2014 ${price}\n{direction_arrow} {change_pct}%     {channel_handle}',
  milestone: '<b>{name}</b> ({symbol}) \u2014 ${price}\n{direction_arrow} Crossed ${milestone_level}     {channel_handle}',
  manual:
    '<b>{name}</b> ({symbol}) \u2014 ${price}\n24h {direction_arrow} {change_pct}%  \u00B7  H ${high_24h}  \u00B7  L ${low_24h}\n{channel_handle}',
  chart: '<b>{name}</b> ({symbol}) \u2014 {period_label}\n{channel_handle}',
};

// Documentation shown by /variables — grouped by where each one is
// actually populated, since e.g. {milestone_level} is only ever non-empty
// on a milestone alert.
const VARIABLE_DOCS = [
  { group: 'Always available', vars: ['symbol', 'name', 'coin_emoji', 'price', 'time', 'date', 'coin_rank', 'channel_name', 'channel_handle', 'bot_name'] },
  { group: 'Threshold alerts', vars: ['direction_arrow', 'change_pct', 'change_usd', 'threshold_value', 'threshold_type', 'cooldown_remaining'] },
  { group: 'Milestone alerts', vars: ['direction_arrow', 'milestone_level', 'next_milestone'] },
  { group: 'Manual posts', vars: ['direction_arrow', 'change_pct', 'high_24h', 'low_24h', 'open_24h', 'volume_24h', 'change_since_last_post'] },
  { group: 'Charts', vars: ['period_label'] },
  { group: 'Stats', vars: ['alert_count_today'] },
];

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Renders a template against a variable map. Any {var} whose value is null
// or undefined causes the WHOLE LINE containing it to be dropped (this is
// what makes the defaults automatically skip the % row for stablecoins,
// the milestone row on non-milestone alerts, etc. — no conditional syntax
// for the admin to learn). {var} names not present in the map at all are
// left untouched so a typo is visible in /previewcaption rather than
// silently vanishing.
function render(template, vars) {
  const lines = template.split('\n');
  const kept = [];

  for (const line of lines) {
    const tokens = [...line.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
    const knownTokensOnLine = tokens.filter((t) => Object.prototype.hasOwnProperty.call(vars, t));
    const hasNullKnownToken = knownTokensOnLine.some((t) => vars[t] === null || vars[t] === undefined);
    if (tokens.length && knownTokensOnLine.length && hasNullKnownToken) continue; // drop this line

    const rendered = line.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return match; // leave {typo} visible
      const value = vars[name];
      return value === null || value === undefined ? '' : escapeHtml(String(value));
    });
    kept.push(rendered);
  }

  // Collapse accidental runs of blank lines left behind by dropped rows.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function channelHandle(channel) {
  if (channel && typeof channel.chatId === 'string' && channel.chatId.startsWith('@')) {
    return channel.chatId;
  }
  return config.botName.startsWith('@') ? config.botName : `@${config.botName}`;
}

// Builds the full variable map for one send. Every field is optional in
// `ctx` — anything not relevant to this alert type is simply left out
// (which renders as null, triggering the line-drop behavior above).
//
// ctx: { coin, price, changeUsd, changePct, direction, alertType,
//        milestoneLevel, threshold, stats24h, periodLabel, channel,
//        alertCountToday, cooldownRemainingMs, changeSinceLastPost }
function buildVariables(ctx) {
  const { coin } = ctx;
  const now = new Date();

  const vars = {
    symbol: coin.symbol,
    name: coin.name,
    coin_emoji: coin.emoji || null,
    price: format.formatPrice(ctx.price),
    time: now.toISOString().slice(11, 16) + ' UTC',
    date: now.toISOString().slice(0, 10),
    coin_rank: String(config.coins.findIndex((c) => c.symbol === coin.symbol) + 1),
    channel_name: ctx.channel ? ctx.channel.name : null,
    channel_handle: channelHandle(ctx.channel),
    bot_name: config.botName,

    direction_arrow: ctx.direction ? format.directionSymbol(ctx.direction) : null,
    change_pct: ctx.changePct === null || ctx.changePct === undefined ? null : format.formatPct(ctx.changePct).replace('%', ''),
    change_usd: ctx.changeUsd === null || ctx.changeUsd === undefined ? null : format.formatChangeUsd(ctx.changeUsd),
    threshold_value:
      ctx.threshold && ctx.threshold.value !== undefined
        ? ctx.threshold.type === 'pct'
          ? String(ctx.threshold.value)
          : format.formatChangeUsd(ctx.threshold.value)
        : null,
    threshold_type: ctx.threshold ? ctx.threshold.type : null,
    cooldown_remaining: ctx.cooldownRemainingMs !== undefined ? formatMinutes(ctx.cooldownRemainingMs) : null,

    milestone_level: ctx.milestoneLevel !== undefined && ctx.milestoneLevel !== null ? format.formatPrice(ctx.milestoneLevel) : null,
    next_milestone: coin.milestoneStep ? format.formatPrice(nextMilestone(ctx.price, coin.milestoneStep)) : null,

    high_24h: ctx.stats24h ? format.formatPrice(ctx.stats24h.highPrice) : null,
    low_24h: ctx.stats24h ? format.formatPrice(ctx.stats24h.lowPrice) : null,
    open_24h: ctx.stats24h && ctx.stats24h.openPrice !== null && ctx.stats24h.openPrice !== undefined ? format.formatPrice(ctx.stats24h.openPrice) : null,
    volume_24h: ctx.stats24h && ctx.stats24h.quoteVolume !== null && ctx.stats24h.quoteVolume !== undefined ? format.formatPrice(ctx.stats24h.quoteVolume) : null,
    change_since_last_post: ctx.changeSinceLastPost !== undefined && ctx.changeSinceLastPost !== null ? format.formatChangeUsd(ctx.changeSinceLastPost) : null,

    period_label: ctx.periodLabel || null,

    alert_count_today: ctx.alertCountToday !== undefined ? String(ctx.alertCountToday) : null,
  };

  // Threshold/manual captions traditionally show change_pct without a
  // stablecoin badge — enforced by the caller passing direction: null for
  // stablecoins, which already nulls out direction_arrow above and (via
  // the line-drop rule) removes any line referencing it.

  return vars;
}

function formatMinutes(ms) {
  const minutes = Math.max(Math.round(ms / 60000), 0);
  return `${minutes}m`;
}

function nextMilestone(price, step) {
  if (!Number.isFinite(price) || !step) return null;
  return (Math.floor(price / step) + 1) * step;
}

// Looks up a symbol-specific override first (key "type:SYMBOL", e.g.
// "threshold:BTC" — set via /setcaption threshold:BTC <template>), then
// falls back to the type-wide custom template, then the built-in default.
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

// Custom vars never shadow a built-in name — avoids a surprising redefinition
// of e.g. {price}. Called with the already-built base vars so it can check
// for collisions.
function applyCustomVarsWithoutOverride(customVars, baseVars) {
  const merged = {};
  for (const [name, value] of Object.entries(customVars)) {
    if (!Object.prototype.hasOwnProperty.call(baseVars, name)) merged[name] = value;
  }
  return merged;
}

module.exports = {
  DEFAULT_TEMPLATES,
  VARIABLE_DOCS,
  render,
  buildVariables,
  renderCaption,
  channelHandle,
};
