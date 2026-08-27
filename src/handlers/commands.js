const { Input } = require('telegraf');
const config = require('../config');
const menu = require('../views/menu');
const { bbtbMarkup } = require('../views/bbtb');

const thresholdsDb = require('../db/thresholds');
const coinStateDb = require('../db/coinState');
const alertsLogDb = require('../db/alertsLog');
const settingsDb = require('../db/settings');
const eventsDb = require('../db/events');
const heartbeatDb = require('../db/heartbeat');
const channelsDb = require('../db/channels');
const templatesDb = require('../db/templates');
const customVarsDb = require('../db/customVars');
const schedulesDb = require('../db/schedules');
const rulesDb = require('../db/rules');
const milestonesDb = require('../db/milestones');
const cooldownsDb = require('../db/cooldowns');

const marketData = require('../services/marketData');
const binance = require('../services/binance');
const telegramSender = require('../services/telegramSender');
const chartRenderer = require('../services/chartRenderer');
const cardRenderer = require('../services/cardRenderer');
const coinRegistry = require('../services/coinRegistry');
const templateEngine = require('../services/templateEngine');
const actions = require('../services/actions');
const pendingInput = require('../services/pendingInput');
const recentCoins = require('../services/recentCoins');
const undoStack = require('../services/undoStack');

const format = require('../utils/format');
const { parseDuration, formatRemaining } = require('../utils/duration');
const logger = require('../utils/logger');

let pendingAddCoin = null; // single-admin bot — one addcoin confirmation in flight at a time

function inlineReply(ctx, screen) {
  return ctx.reply(screen.text, { reply_markup: { inline_keyboard: screen.keyboard } });
}
function inlineEdit(ctx, screen) {
  return ctx.editMessageText(screen.text, { reply_markup: { inline_keyboard: screen.keyboard } }).catch(() => inlineReply(ctx, screen));
}
function findCoin(symbol) {
  return config.coins.find((c) => c.symbol === symbol);
}

// ---------------------------------------------------------------------------
// Core navigation
// ---------------------------------------------------------------------------
async function start(ctx) {
  await ctx.reply('Welcome to PricePing admin \u2014 use the buttons below to navigate.', bbtbMarkup);
  await home(ctx);
}

async function help(ctx) {
  await ctx.reply(
    `/start \u2014 welcome + main menu\n` +
      `/commands \u2014 open the full button-driven control panel\n` +
      `/status \u2014 bot status, uptime, heartbeat\n` +
      `/prices \u2014 current price for all coins\n` +
      `/post SYMBOL [channel] \u2014 post a price update now\n` +
      `/chart SYMBOL [1h|24h|7d|30d] \u2014 send yourself a chart\n` +
      `/postchart SYMBOL [period] [channel] \u2014 post a chart to a channel\n` +
      `/thresholds \u2014 view thresholds\n` +
      `/setthreshold SYMBOL AMOUNT [pct] \u2014 change a threshold\n` +
      `/milestones \u2014 view milestone steps \u00B7 /setmilestone SYMBOL STEP|off\n` +
      `/setcooldown SYMBOL MINUTES \u00B7 /resetcooldown SYMBOL\n` +
      `/pause [DURATION] / /resume\n` +
      `/mute SYMBOL [DURATION] / /unmute SYMBOL\n` +
      `/addcoin SYMBOL PAIR #COLOR [Name]\n` +
      `/history SYMBOL [channel]\n` +
      `/stats\n` +
      `/channels \u00B7 /addchannel name chat_id \u00B7 /removechannel name \u00B7 /setdefaultchannel name [type]\n` +
      `/setcaption TYPE[:SYMBOL] <template> \u00B7 /previewcaption TYPE[:SYMBOL] \u00B7 /resetcaption TYPE[:SYMBOL]\n` +
      `/variables \u2014 list caption variables \u00B7 /setvar name value \u00B7 /delvar name\n` +
      `/schedule <line> \u00B7 /schedules \u00B7 /addrule <line> \u00B7 /rules\n` +
      `/broadcast CHANNEL message... \u2014 plain text post\n` +
      `/exportconfig \u00B7 /importconfig\n` +
      `/reset [thresholds|milestones|cooldowns|captions|vars|channels|automation|everything]\n` +
      `/test [SYMBOL] \u2014 advanced test menu\n` +
      `/whoami\n\n` +
      `Or type /commands for the full button-driven menu.`
  );
}

async function home(ctx) {
  const [paused, pausedUntil, alertsToday, [lastEvent], heartbeat, pinnedKeys] = await Promise.all([
    settingsDb.isPaused(),
    settingsDb.getPausedUntil(),
    alertsLogDb.countToday(),
    eventsDb.latest(1),
    heartbeatDb.get(),
    settingsDb.getPinnedActions(),
  ]);
  await inlineReply(
    ctx,
    menu.home({ paused, pausedUntil, uptimeSeconds: process.uptime(), alertsToday, lastEvent: lastEvent || null, heartbeat, pinnedKeys })
  );
}

async function hubCmd(ctx) {
  await inlineReply(ctx, menu.hub());
}

async function pricesCmd(ctx) {
  let map = {};
  try {
    map = Object.fromEntries(await marketData.fetchAllPrices());
  } catch (err) {
    logger.warn('Failed to fetch prices for /prices', { message: err.message });
    await ctx.reply('Could not reach Binance right now \u2014 try again shortly.');
    return;
  }
  await inlineReply(ctx, menu.prices(map));
}

async function statsCmd(ctx) {
  const [today, allTime, perCoin] = await Promise.all([
    alertsLogDb.countToday(),
    alertsLogDb.countAllTime(),
    alertsLogDb.countPerCoin(),
  ]);
  await inlineReply(ctx, menu.stats({ today, allTime, perCoin }));
}

async function settingsCmd(ctx) {
  await inlineReply(ctx, menu.settings());
}
async function pinManageScreen(ctx) {
  await inlineEdit(ctx, menu.pinManage(await settingsDb.getPinnedActions()));
}
async function pinToggle(ctx, key) {
  const current = await settingsDb.getPinnedActions();
  let next;
  if (current.includes(key)) {
    next = current.filter((k) => k !== key);
  } else if (current.length >= 3) {
    await ctx.answerCbQuery('Already have 3 pinned — unpin one first.');
    return;
  } else {
    next = [...current, key];
  }
  await settingsDb.setPinnedActions(next);
  await ctx.answerCbQuery();
  await pinManageScreen(ctx);
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
function parseThresholdArgs(parts) {
  const symbol = (parts[1] || '').toUpperCase();
  let amountRaw = parts[2] || '';
  let type = 'usd';
  if (amountRaw.endsWith('%')) {
    type = 'pct';
    amountRaw = amountRaw.slice(0, -1);
  } else if ((parts[3] || '').toLowerCase() === 'pct') {
    type = 'pct';
  }
  return { symbol, amount: Number(amountRaw), type };
}

async function thresholdsCmd(ctx) {
  await inlineReply(ctx, menu.thresholds(await thresholdsDb.getAll()));
}

function thresholdStep(threshold) {
  if (!threshold) return 1;
  if (threshold.type === 'pct') return 0.5;
  const raw = threshold.value * 0.1;
  return Math.max(Math.round(raw * 100) / 100, 0.01);
}

async function thresholdAdjust(ctx, symbol, dir) {
  const current = await thresholdsDb.get(symbol);
  if (!current) {
    await ctx.answerCbQuery('No threshold set for this coin yet — use /setthreshold.');
    return;
  }
  const step = thresholdStep(current);
  const minValue = current.type === 'pct' ? 0.1 : 0.01;
  const nextValue = Math.max(Math.round((current.value + (dir === 'inc' ? step : -step)) * 100) / 100, minValue);
  await thresholdsDb.set(symbol, nextValue, current.type);
  await ctx.answerCbQuery();
  await coinSettingsScreen(ctx, symbol);
}

async function setThreshold(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const { symbol, amount, type } = parseThresholdArgs(parts);
  const coin = findCoin(symbol);
  if (!coin) {
    await ctx.reply(`Usage: /setthreshold SYMBOL AMOUNT [pct]\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`);
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply('Amount must be a positive number, e.g. /setthreshold BTC 400 or /setthreshold BTC 2 pct');
    return;
  }
  const previous = await thresholdsDb.get(symbol);
  await thresholdsDb.set(symbol, amount, type);
  const undoId = undoStack.push(`${symbol} threshold`, async () => {
    if (previous) await thresholdsDb.set(symbol, previous.value, previous.type);
  });

  const displayAmount = type === 'pct' ? `${amount}%` : `$${amount}`;
  let warning = '';
  const referenceDefault = config.defaultThresholds[symbol];
  if (referenceDefault && type === 'usd' && amount > referenceDefault * 50) {
    warning = `\n\u26A0\uFE0F That's ${Math.round(amount / referenceDefault)}\u00D7 the typical default for ${symbol} (\$${referenceDefault}) \u2014 double check this was intentional.`;
  }
  await ctx.reply(`Threshold for ${symbol} set to ${displayAmount}${type === 'pct' ? ' (of price)' : ''}.${warning}`, {
    reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
  });
}

async function thresholdSetExactStart(ctx, symbol) {
  const prompt = `Send the exact threshold for ${symbol}, e.g. 400 or 2%`;
  pendingInput.set('setexactthreshold', { symbol }, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}

async function undoThreshold(ctx, symbol) {
  await ctx.reply(`Use the "\u21A9 Undo" button that came with the confirmation message instead \u2014 undo is now generic and time-limited, not stored per-symbol.`);
}

async function undoExecute(ctx, id) {
  const entry = undoStack.consume(id);
  if (!entry) {
    await ctx.answerCbQuery('Nothing to undo (may have expired or already been used).');
    return;
  }
  await ctx.answerCbQuery('Undoing...');
  try {
    await entry.undoFn();
    await ctx.reply(`Undone: ${entry.label}.`);
  } catch (err) {
    await ctx.reply(`Could not undo "${entry.label}": ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Unified coin settings screen — threshold, milestone, cooldown, mute
// ---------------------------------------------------------------------------
async function coinSettingsMenuScreen(ctx) {
  await inlineEdit(ctx, menu.coinSettingsMenu(recentCoins.getRecent()));
}

async function coinSettingsScreen(ctx, symbol) {
  const coin = findCoin(symbol);
  if (!coin) {
    await ctx.answerCbQuery('Unknown coin');
    return;
  }
  const [threshold, milestoneMap, cooldownOverrides, states, globallyPaused, lastAlerts] = await Promise.all([
    thresholdsDb.get(symbol),
    milestonesDb.getAll(),
    cooldownsDb.getAll(),
    coinStateDb.getAll(),
    settingsDb.isPaused(),
    alertsLogDb.recentForSymbol(symbol, 1),
  ]);
  const milestone = milestoneMap.get(symbol) || { step: coin.milestoneStep, isCustom: false, isDisabled: false };
  const isDefaultCooldown = cooldownOverrides[symbol] === undefined;
  const cooldownMinutes = cooldownOverrides[symbol] ?? config.cooldownMinutes;
  const mutedUntil = (states[symbol] || {}).pausedUntil;
  const lastAlertText = lastAlerts.length
    ? `${format.timeAgo(lastAlerts[0].created_at)} (${lastAlerts[0].alert_type})`
    : null;
  await inlineEdit(
    ctx,
    menu.coinSettings(symbol, { threshold, milestone, cooldownMinutes, isDefaultCooldown, mutedUntil, globallyPaused, lastAlertText })
  );
}

// --- Milestones ---
async function milestonesScreen(ctx) {
  await inlineEdit(ctx, menu.milestoneList(await milestonesDb.getAll()));
}
async function milestonesCmd(ctx) {
  await inlineReply(ctx, menu.milestoneList(await milestonesDb.getAll()));
}

async function milestoneHeuristicBase(symbol) {
  const threshold = await thresholdsDb.get(symbol);
  return threshold ? (threshold.type === 'usd' ? threshold.value * 20 : 100) : 100;
}

async function milestoneAdjust(ctx, symbol, dir) {
  let base = await milestonesDb.getEffectiveStep(symbol);
  if (!base) base = await milestoneHeuristicBase(symbol);
  const step = Math.max(Math.round(base * 0.1 * 100) / 100, 0.01);
  const next = Math.max(Math.round((base + (dir === 'inc' ? step : -step)) * 100) / 100, 0.01);
  await milestonesDb.set(symbol, next);
  await ctx.answerCbQuery();
  await coinSettingsScreen(ctx, symbol);
}

async function milestoneToggle(ctx, symbol) {
  const current = await milestonesDb.getEffectiveStep(symbol);
  if (current !== null && current !== undefined) {
    await milestonesDb.disable(symbol);
    await ctx.answerCbQuery('Milestones disabled');
  } else {
    await milestonesDb.clear(symbol);
    const effective = await milestonesDb.getEffectiveStep(symbol);
    if (effective === null || effective === undefined) {
      const base = await milestoneHeuristicBase(symbol);
      await milestonesDb.set(symbol, Math.max(Math.round(base * 100) / 100, 1));
    }
    await ctx.answerCbQuery('Milestones enabled');
  }
  await coinSettingsScreen(ctx, symbol);
}

async function milestoneSetExactStart(ctx, symbol) {
  const prompt = `Send the exact milestone step for ${symbol}, e.g. 500, or "off" to disable.`;
  pendingInput.set('setexactmilestone', { symbol }, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}

async function setMilestoneCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const valueArg = (parts[2] || '').toLowerCase();
  if (!findCoin(symbol) || !valueArg) {
    await ctx.reply('Usage: /setmilestone SYMBOL STEP\nOr: /setmilestone SYMBOL off');
    return;
  }
  const priorMap = await milestonesDb.getAll();
  const prior = priorMap.get(symbol) || { step: null, isCustom: false, isDisabled: false };
  const undoFn = async () => {
    if (prior.isDisabled) await milestonesDb.disable(symbol);
    else if (prior.isCustom) await milestonesDb.set(symbol, prior.step);
    else await milestonesDb.clear(symbol);
  };

  if (valueArg === 'off') {
    await milestonesDb.disable(symbol);
    const undoId = undoStack.push(`${symbol} milestone`, undoFn);
    await ctx.reply(`${symbol} milestones turned off.`, {
      reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
    });
    return;
  }
  const step = Number(valueArg);
  if (!Number.isFinite(step) || step <= 0) {
    await ctx.reply('Step must be a positive number, or "off".');
    return;
  }
  await milestonesDb.set(symbol, step);
  const undoId = undoStack.push(`${symbol} milestone`, undoFn);
  await ctx.reply(`${symbol} will now post a milestone alert every $${format.formatChangeUsd(step)} (e.g. crossing 71,500 / 72,000 / 72,500...).`, {
    reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
  });
}

// --- Cooldown overrides ---
async function cooldownAdjust(ctx, symbol, dir) {
  const current = await cooldownsDb.getEffective(symbol);
  const next = Math.max(current + (dir === 'inc' ? 1 : -1), 1);
  await cooldownsDb.set(symbol, next);
  await ctx.answerCbQuery();
  await coinSettingsScreen(ctx, symbol);
}
async function cooldownResetBtn(ctx, symbol) {
  await cooldownsDb.clear(symbol);
  await ctx.answerCbQuery('Reset to default');
  await coinSettingsScreen(ctx, symbol);
}
async function setCooldownCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const minutes = Number(parts[2]);
  if (!findCoin(symbol) || !Number.isFinite(minutes)) {
    await ctx.reply('Usage: /setcooldown SYMBOL MINUTES');
    return;
  }
  if (minutes < 1) {
    await ctx.reply('Cooldown can\'t go below 1 minute — that\'s a hard floor to stop an accidental spam loop.');
    return;
  }
  const previous = await cooldownsDb.getAll();
  const hadOverride = Object.prototype.hasOwnProperty.call(previous, symbol);
  const previousValue = previous[symbol];
  await cooldownsDb.set(symbol, minutes);
  const undoId = undoStack.push(`${symbol} cooldown`, async () => {
    if (hadOverride) await cooldownsDb.set(symbol, previousValue);
    else await cooldownsDb.clear(symbol);
  });
  await ctx.reply(`${symbol} cooldown set to ${minutes}m.`, {
    reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
  });
}
async function resetCooldownCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  if (!findCoin(symbol)) {
    await ctx.reply('Usage: /resetcooldown SYMBOL');
    return;
  }
  await cooldownsDb.clear(symbol);
  await ctx.reply(`${symbol} cooldown reset to the default (${config.cooldownMinutes}m).`);
}

// ---------------------------------------------------------------------------
// Pause / resume / mute
// ---------------------------------------------------------------------------
async function pause(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const durationMs = parseDuration(parts[1]);
  if (durationMs) {
    await settingsDb.setPausedUntil(new Date(Date.now() + durationMs));
    await ctx.reply(`Paused for ${formatRemaining(durationMs)} \u2014 will auto-resume, or /resume any time sooner.`);
    return;
  }
  await settingsDb.setPaused(true);
  await ctx.reply('Paused \u2014 no alerts will be posted until you /resume.');
}

async function resume(ctx) {
  await settingsDb.setPaused(false);
  if (ctx.updateType === 'callback_query') {
    await ctx.answerCbQuery('Resumed');
    await home(ctx);
  } else {
    await ctx.reply('Resumed \u2014 alerts will post as usual.');
  }
}

async function pauseMenuScreen(ctx) {
  const [paused, pausedUntil] = await Promise.all([settingsDb.isPaused(), settingsDb.getPausedUntil()]);
  await inlineEdit(ctx, menu.pauseMenu({ paused, pausedUntil }));
}

const DURATION_CODES = { '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d', indef: null };

async function pauseApply(ctx, code) {
  const durationStr = DURATION_CODES[code];
  if (durationStr === undefined) {
    await ctx.answerCbQuery('Unknown duration');
    return;
  }
  if (durationStr === null) {
    await settingsDb.setPaused(true);
  } else {
    await settingsDb.setPausedUntil(new Date(Date.now() + parseDuration(durationStr)));
  }
  await ctx.answerCbQuery('Paused');
  await home(ctx);
}

async function mute(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  if (!findCoin(symbol)) {
    await ctx.reply(`Usage: /mute SYMBOL [DURATION]\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`);
    return;
  }
  const durationMs = parseDuration(parts[2]) || config.defaultMuteMs;
  await coinStateDb.setMuteUntil(symbol, new Date(Date.now() + durationMs));
  await ctx.reply(`${symbol} muted for ${formatRemaining(durationMs)}. /unmute ${symbol} to lift it early.`);
}

async function unmute(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  if (!findCoin(symbol)) {
    await ctx.reply('Usage: /unmute SYMBOL');
    return;
  }
  await coinStateDb.clearMute(symbol);
  await ctx.reply(`${symbol} unmuted.`);
}

async function muteMenuScreen(ctx) {
  const states = await coinStateDb.getAll();
  const mutedMap = {};
  for (const [symbol, state] of Object.entries(states)) mutedMap[symbol] = state.pausedUntil;
  await inlineEdit(ctx, menu.muteMenu(recentCoins.getRecent(), mutedMap));
}
async function muteDurationScreen(ctx, symbol) {
  await inlineEdit(ctx, menu.muteDurationPicker(symbol));
}
async function muteApply(ctx, symbol, code) {
  const durationStr = DURATION_CODES[code];
  const ms = durationStr === null ? 100 * 365 * 24 * 60 * 60 * 1000 : parseDuration(durationStr);
  await coinStateDb.setMuteUntil(symbol, new Date(Date.now() + ms));
  recentCoins.noteCoin(symbol);
  await ctx.answerCbQuery(`${symbol} muted`);
  await muteMenuScreen(ctx);
}
async function muteClear(ctx, symbol) {
  await coinStateDb.clearMute(symbol);
  await ctx.answerCbQuery(`${symbol} unmuted`);
  await muteMenuScreen(ctx);
}

// ---------------------------------------------------------------------------
// Post & chart
// ---------------------------------------------------------------------------
async function postMenuScreen(ctx) {
  await inlineEdit(ctx, menu.postMenu(recentCoins.getRecent()));
}
async function postChannelScreen(ctx, symbol) {
  const channels = await channelsDb.getAll();
  await inlineEdit(ctx, menu.postChannelPicker(symbol, channels));
}
async function postExecute(ctx, symbol, channelName) {
  await ctx.answerCbQuery('Posting...');
  const result = await actions.postPriceUpdate(ctx.telegram, symbol, channelName);
  await ctx.reply(result.message);
}
async function postCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  if (!symbol) {
    await ctx.reply('Usage: /post SYMBOL [channel] (e.g. /post BTC or /post BTC vip)');
    return;
  }
  const result = await actions.postPriceUpdate(ctx.telegram, symbol, parts[2]);
  await ctx.reply(result.message);
}
async function manualPost(ctx, symbol) {
  const result = await actions.postPriceUpdate(ctx.telegram, symbol, undefined);
  await ctx.reply(result.message);
}

async function chartMenuScreen(ctx) {
  await inlineEdit(ctx, menu.chartMenu(recentCoins.getRecent()));
}
async function chartPeriodScreen(ctx, symbol) {
  await inlineEdit(ctx, menu.chartPeriodPicker(symbol));
}
async function chartChannelScreen(ctx, symbol, period) {
  const channels = await channelsDb.getAll();
  await inlineEdit(ctx, menu.chartChannelPicker(symbol, period, channels));
}
async function chartSendExecute(ctx, symbol, period, channelName) {
  await ctx.answerCbQuery('Posting chart...');
  const result = await actions.postChartAction(ctx.telegram, symbol, period, channelName);
  await ctx.reply(result.message);
}
async function chartPreviewExecute(ctx, symbol, period) {
  await ctx.answerCbQuery('Rendering...');
  await sendChartPreview(ctx, symbol, period);
}
async function sendChartPreview(ctx, symbol, periodKey) {
  const coin = findCoin(symbol);
  const preset = chartRenderer.PERIOD_PRESETS[periodKey];
  if (!coin || !preset) {
    await ctx.reply('Unknown coin or period.');
    return;
  }
  let candles;
  try {
    candles = await marketData.fetchKlinesForSymbol(symbol, preset.interval, preset.limit);
  } catch (err) {
    await ctx.reply('Could not reach Binance right now.');
    return;
  }
  if (candles.length < 2) {
    await ctx.reply(`Not enough data to chart ${symbol}.`);
    return;
  }
  const buffer = await chartRenderer.renderChart({ coin, candles, periodKey });
  await ctx.replyWithPhoto(Input.fromBuffer(buffer, `${symbol}-${periodKey}.png`), {
    caption: `${coin.name} (${coin.symbol}) \u2014 ${preset.label}`,
  });
}
async function chartCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const periodKey = (parts[2] || '24h').toLowerCase();
  if (!findCoin(symbol)) {
    await ctx.reply(`Usage: /chart SYMBOL [1h|24h|7d|30d]\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`);
    return;
  }
  await sendChartPreview(ctx, symbol, periodKey);
}
async function postChartCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const periodKey = (parts[2] || '24h').toLowerCase();
  const channelName = parts[3];
  if (!findCoin(symbol)) {
    await ctx.reply(`Usage: /postchart SYMBOL [period] [channel]`);
    return;
  }
  const result = await actions.postChartAction(ctx.telegram, symbol, periodKey, channelName);
  await ctx.reply(result.message);
}

// ---------------------------------------------------------------------------
// Coins — /addcoin now confirm-before-create
// ---------------------------------------------------------------------------
async function addCoinCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  await stageAddCoin(ctx, parts.slice(1));
}
async function addCoinStart(ctx) {
  const prompt = 'Send: SYMBOL BINANCEPAIR #HEXCOLOR [Name]\nExample: ADA ADAUSDT #0033AD Cardano';
  pendingInput.set('addcoin', {}, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
// Damerau-Levenshtein (with adjacent transposition) rather than plain
// Levenshtein — a swapped-letter typo like "XPR" vs "XRP" is distance 1
// here but distance 2 under plain Levenshtein, and letter swaps are one
// of the most common typo patterns, so this is the version worth using.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

async function stageAddCoin(ctx, parts) {
  const symbol = (parts[0] || '').toUpperCase();
  const pair = (parts[1] || '').toUpperCase();
  const color = parts[2] || '';
  const name = parts.slice(3).join(' ') || symbol;

  if (!symbol || !pair || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    await ctx.reply('Usage: SYMBOL BINANCEPAIR #HEXCOLOR [Name]\nExample: ADA ADAUSDT #0033AD Cardano');
    return;
  }
  if (findCoin(symbol)) {
    await ctx.reply(`${symbol} is already tracked.`);
    return;
  }

  // Catches "XPR" vs "XRP" style typos before they become a permanently
  // tracked duplicate — only fires on a near-miss (edit distance 1), never
  // on an unrelated short symbol.
  const lookalike = config.coins.find((c) => symbol.length >= 3 && levenshtein(symbol, c.symbol) === 1);
  const warning = lookalike ? `\n\u26A0\uFE0F This looks similar to already-tracked ${lookalike.symbol} \u2014 double check this isn't a typo.` : '';

  pendingAddCoin = { symbol, name, pair, color };
  await inlineReply(ctx, menu.addCoinConfirm({ symbol, name, pair, color }, warning));
}
async function addCoinConfirmExecute(ctx) {
  if (!pendingAddCoin) {
    await ctx.answerCbQuery('Nothing pending');
    return;
  }
  await ctx.answerCbQuery('Adding...');
  const { symbol, name, pair, color } = pendingAddCoin;
  pendingAddCoin = null;
  try {
    const { logoSource } = await coinRegistry.addCoin({ symbol, name, binancePair: pair, color });
    await ctx.reply(
      `${symbol} added \u2014 tracking ${pair}. Logo ${logoSource === 'downloaded' ? 'downloaded' : 'using a plain fallback'}.`
    );
  } catch (err) {
    await ctx.reply(`Could not add ${symbol}: ${err.message}`);
  }
}
async function addCoinCancel(ctx) {
  pendingAddCoin = null;
  await ctx.answerCbQuery('Cancelled');
  await ctx.reply('Cancelled — nothing added.');
}

async function historyMenuScreen(ctx) {
  await inlineEdit(ctx, menu.historyMenu(recentCoins.getRecent()));
}
async function historyCoinScreen(ctx, symbol, channelName = null, offset = 0) {
  recentCoins.noteCoin(symbol);
  const [rows, channels, total] = await Promise.all([
    alertsLogDb.recentForSymbol(symbol, 10, channelName, offset),
    channelsDb.getAll(),
    alertsLogDb.countForSymbol(symbol, channelName),
  ]);
  const lines = rows.map((r) => {
    const arrow = r.direction === 'up' ? '\u25B2' : '\u25BC';
    return `${format.timeAgo(r.created_at)}  ${arrow} $${format.formatPrice(Number(r.price))}  [${r.alert_type} \u2192 #${r.channel_name}]`;
  });
  await inlineEdit(ctx, menu.historyDetail(symbol, lines, channels, channelName, offset, total));
}
async function historyCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const channelName = parts[2];
  if (!findCoin(symbol)) {
    await ctx.reply('Usage: /history SYMBOL [channel]');
    return;
  }
  const rows = await alertsLogDb.recentForSymbol(symbol, 10, channelName);
  if (!rows.length) {
    await ctx.reply(`No alerts logged yet for ${symbol}${channelName ? ` on #${channelName}` : ''}.`);
    return;
  }
  const lines = rows.map((r) => {
    const arrow = r.direction === 'up' ? '\u25B2' : '\u25BC';
    return `${format.timeAgo(r.created_at)}  ${arrow} $${format.formatPrice(Number(r.price))}  [${r.alert_type} \u2192 #${r.channel_name}]`;
  });
  await ctx.reply(`Recent ${symbol} activity\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
async function channelsScreen(ctx) {
  const [channels, defaultsByType] = await Promise.all([channelsDb.getAll(), channelsDb.getDefaultsByType()]);
  await inlineEdit(ctx, menu.channelList(channels, defaultsByType));
}
async function channelsListCmd(ctx) {
  const [channels, defaultsByType] = await Promise.all([channelsDb.getAll(), channelsDb.getDefaultsByType()]);
  await inlineReply(ctx, menu.channelList(channels, defaultsByType));
}
async function channelAddStart(ctx) {
  const prompt = 'Send: name chat_id\nExample: vip -1001234567890  (or vip @MyVipChannel)';
  pendingInput.set('addchannel', {}, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function addChannelCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  await runAddChannel(ctx, parts.slice(1));
}
async function runAddChannel(ctx, parts) {
  const name = parts[0];
  const chatId = parts[1];
  if (!name || !chatId) {
    await ctx.reply('Usage: name chat_id\nExample: vip -1001234567890');
    return;
  }
  const existing = await channelsDb.get(name);

  // Confirm the bot can actually see this chat before saving it — catches
  // a typo'd chat_id immediately instead of it silently failing the first
  // time something tries to post there.
  try {
    await ctx.telegram.getChat(chatId);
  } catch (err) {
    await ctx.reply(
      `Could not verify chat ${chatId}: ${err.message}\n` +
        `Make sure the bot is added as an admin there, and the chat_id is correct. Nothing was saved.`
    );
    return;
  }

  await channelsDb.add(name, chatId);
  const overwriteNote = existing ? ` (previously pointed to ${existing.chatId})` : '';
  await ctx.reply(`Channel "${name}" added \u2192 ${chatId}${overwriteNote}. Use /setdefaultchannel ${name} to make it the default target.`);
}
async function removeChannelCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const name = parts[1];
  if (!name) {
    await ctx.reply('Usage: /removechannel name');
    return;
  }
  await channelsDb.remove(name);
  await ctx.reply(`Channel "${name}" removed.`);
}
async function channelDel(ctx, name) {
  const channel = await channelsDb.get(name);
  if (channel && channel.isDefault) {
    await ctx.answerCbQuery('Cannot remove the default channel — set another as default first.');
    return;
  }
  await channelsDb.remove(name);
  if (channel) {
    const undoId = undoStack.push(`removed channel "${name}"`, async () => channelsDb.add(channel.name, channel.chatId));
    await ctx.answerCbQuery('Removed');
    await ctx.reply(`Channel "${name}" removed.`, {
      reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
    });
  } else {
    await ctx.answerCbQuery('Removed');
  }
  await channelsScreen(ctx);
}
async function setDefaultChannelCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const name = parts[1];
  const alertType = parts[2];
  const channel = await channelsDb.get(name);
  if (!channel) {
    await ctx.reply(`No channel named "${name}". /channels to see the list.`);
    return;
  }
  if (alertType) {
    if (!['threshold', 'milestone', 'manual', 'chart', 'digest'].includes(alertType)) {
      await ctx.reply('Type must be one of: threshold, milestone, manual, chart, digest');
      return;
    }
    await channelsDb.setDefaultForType(alertType, name);
    await ctx.reply(`"${name}" is now the default channel for ${alertType} alerts specifically.`);
    return;
  }
  await channelsDb.setDefault(name);
  await ctx.reply(`"${name}" is now the overall default channel.`);
}
async function clearDefaultChannelTypeCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const alertType = parts[1];
  if (!alertType) {
    await ctx.reply('Usage: /cleardefaultchannel TYPE (threshold, milestone, manual, chart, digest)');
    return;
  }
  await channelsDb.clearDefaultForType(alertType);
  await ctx.reply(`Per-type default for "${alertType}" cleared — falls back to the overall default.`);
}
async function channelSetDefault(ctx, name) {
  await channelsDb.setDefault(name);
  await ctx.answerCbQuery(`${name} is now default`);
  await channelsScreen(ctx);
}
async function channelTypeDefaultScreen(ctx) {
  await ctx.answerCbQuery();
  await inlineEdit(ctx, menu.channelTypePicker());
}
async function channelTypeDefaultChannelScreen(ctx, alertType) {
  await ctx.answerCbQuery();
  const channels = await channelsDb.getAll();
  await inlineEdit(ctx, menu.channelTypeDefaultPicker(alertType, channels));
}
async function channelSetTypeDefaultExecute(ctx, alertType, channelName) {
  await channelsDb.setDefaultForType(alertType, channelName);
  await ctx.answerCbQuery(`${alertType} \u2192 ${channelName}`);
  await channelsScreen(ctx);
}
async function channelClearTypeDefault(ctx, alertType) {
  await channelsDb.clearDefaultForType(alertType);
  await ctx.answerCbQuery('Cleared');
  await channelsScreen(ctx);
}

async function broadcastMenuScreen(ctx) {
  const channels = await channelsDb.getAll();
  await inlineEdit(ctx, menu.broadcastChannelPicker(channels));
}
async function broadcastPick(ctx, channelName) {
  const prompt = `Send the message to broadcast to #${channelName}.`;
  pendingInput.set('broadcast', { channelName }, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}

// ---------------------------------------------------------------------------
// Captions / templates / variables — now with type:SYMBOL overrides
// ---------------------------------------------------------------------------
async function captionTypesScreen(ctx) {
  await inlineEdit(ctx, menu.captionTypes());
}
async function captionDetailScreen(ctx, alertType) {
  const custom = await templatesDb.get(alertType);
  const template = custom || templateEngine.DEFAULT_TEMPLATES[alertType];
  await inlineEdit(ctx, menu.captionDetail(alertType, template, !!custom));
}
async function captionEditStart(ctx, alertType) {
  const prompt = `Send the new caption template for "${alertType}". Use {variables} \u2014 see /variables. Send it as one message (multiple lines OK).`;
  pendingInput.set('setcaption', { alertType }, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function captionReset(ctx, alertType) {
  const previous = await templatesDb.get(alertType);
  await templatesDb.reset(alertType);
  if (previous) {
    const undoId = undoStack.push(`"${alertType}" caption`, async () => templatesDb.set(alertType, previous));
    await ctx.answerCbQuery('Reset to default');
    await ctx.reply(`Caption for "${alertType}" reset to default.`, {
      reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
    });
  } else {
    await ctx.answerCbQuery('Reset to default');
  }
  await captionDetailScreen(ctx, alertType);
}
async function captionOverridesScreen(ctx, alertType) {
  await ctx.answerCbQuery();
  await inlineEdit(ctx, menu.captionCoinPicker(alertType, recentCoins.getRecent()));
}
async function captionCoinDetailScreen(ctx, alertType, symbol) {
  const key = `${alertType}:${symbol}`;
  const custom = await templatesDb.get(key);
  const template = custom || templateEngine.DEFAULT_TEMPLATES[alertType];
  await inlineEdit(ctx, menu.captionCoinDetail(alertType, symbol, template, !!custom));
}
async function captionCoinEditStart(ctx, alertType, symbol) {
  const prompt = `Send the new caption template for "${alertType}" — just for ${symbol}. Use {variables} \u2014 see /variables.`;
  pendingInput.set('setcaption', { alertType: `${alertType}:${symbol}` }, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function captionCoinPreviewBtn(ctx, alertType, symbol) {
  await ctx.answerCbQuery('Rendering preview...');
  await sendCaptionPreview(ctx, `${alertType}:${symbol}`);
}
async function captionCoinResetBtn(ctx, alertType, symbol) {
  await templatesDb.reset(`${alertType}:${symbol}`);
  await ctx.answerCbQuery('Override removed');
  await captionCoinDetailScreen(ctx, alertType, symbol);
}
async function captionPreview(ctx, alertType) {
  await ctx.answerCbQuery('Rendering preview...');
  await sendCaptionPreview(ctx, alertType);
}
function sampleCoinFor() {
  return findCoin('BTC') || config.coins[0];
}
async function sendCaptionPreview(ctx, alertTypeArg) {
  const base = alertTypeArg.split(':')[0].toLowerCase();
  const symbolPart = alertTypeArg.split(':')[1];
  const coin = symbolPart ? findCoin(symbolPart.toUpperCase()) : sampleCoinFor();
  if (!templateEngine.DEFAULT_TEMPLATES[base] || !coin) {
    await ctx.reply(symbolPart ? `Unknown symbol: ${symbolPart}` : `Unknown caption type "${base}".`);
    return;
  }
  const sampleChannel = { name: 'preview', chatId: '@PricePing' };
  let ctxData;
  if (base === 'threshold') {
    ctxData = { coin, price: 109842.5, changeUsd: 512, changePct: 0.47, direction: 'up', alertType: 'threshold', threshold: { value: 400, type: 'usd' }, cooldownRemainingMs: 300000, channel: sampleChannel };
  } else if (base === 'milestone') {
    ctxData = { coin, price: 110032, changeUsd: null, changePct: null, direction: 'up', alertType: 'milestone', milestoneLevel: 110000, channel: sampleChannel };
  } else if (base === 'manual') {
    ctxData = { coin, price: 109842.5, direction: 'up', changePct: 1.8, stats24h: { priceChangePercent: 1.8, highPrice: 110500, lowPrice: 108200, openPrice: 108000, quoteVolume: 500000000 }, alertType: 'manual', changeSinceLastPost: 234.1, alertCountToday: 3, channel: sampleChannel };
  } else {
    ctxData = { coin, periodLabel: 'Last 24 hours', alertType: 'chart', channel: sampleChannel };
  }
  const rendered = await templateEngine.renderCaption(base, ctxData);

  // Renders the actual card/chart image too, not just the caption text —
  // seeing how the wording sits next to the real visual catches issues
  // (too-long lines, a variable that reads oddly) that text-only never would.
  try {
    let buffer;
    if (base === 'threshold' || base === 'milestone') {
      buffer = await cardRenderer.renderCard(ctxData);
    } else if (base === 'manual') {
      buffer = await cardRenderer.renderRichCard(ctxData);
    } else {
      const fakeCandles = Array.from({ length: 20 }, (_, i) => ({ openTime: i, close: 108000 + Math.sin(i / 2) * 800 }));
      buffer = await chartRenderer.renderChart({ coin, candles: fakeCandles, periodKey: '24h' });
    }
    await ctx.replyWithPhoto(Input.fromBuffer(buffer, 'preview.png'), { caption: rendered, parse_mode: 'HTML' });
  } catch (err) {
    logger.warn('Caption preview image render failed, falling back to text-only', { message: err.message });
    await ctx.reply('Preview (sample data):\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    await ctx.reply(rendered, { parse_mode: 'HTML' });
  }
}

async function setCaptionCmd(ctx) {
  const text = ctx.message.text.trim();
  const match = text.match(/^\/setcaption\s+(\S+)\s+([\s\S]+)$/);
  if (!match) {
    await ctx.reply('Usage: /setcaption TYPE[:SYMBOL] <template>\nTypes: threshold, milestone, manual, chart\nExample: /setcaption threshold:BTC \ud83d\udea8 {symbol} moved to ${price}!');
    return;
  }
  await runSetCaption(ctx, match[1], match[2]);
}
async function runSetCaption(ctx, alertTypeArg, template) {
  const base = alertTypeArg.split(':')[0].toLowerCase();
  if (!templateEngine.DEFAULT_TEMPLATES[base]) {
    await ctx.reply(`Unknown caption type "${base}". Choose one of: ${Object.keys(templateEngine.DEFAULT_TEMPLATES).join(', ')}`);
    return;
  }
  const symbolPart = alertTypeArg.split(':')[1];
  if (symbolPart && !findCoin(symbolPart.toUpperCase())) {
    await ctx.reply(`Unknown symbol: ${symbolPart}`);
    return;
  }
  const key = symbolPart ? `${base}:${symbolPart.toUpperCase()}` : base;
  const previous = await templatesDb.get(key);
  await templatesDb.set(key, template);
  const undoId = undoStack.push(`"${key}" caption`, async () => {
    if (previous) await templatesDb.set(key, previous);
    else await templatesDb.reset(key);
  });
  const overwriteNote = previous ? ' (overwrote an existing custom template)' : '';
  await ctx.reply(`Caption for "${key}" updated${overwriteNote}. Use /previewcaption ${key} to see it rendered.`, {
    reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
  });
}
async function previewCaptionCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const arg = parts[1];
  if (!arg) {
    await ctx.reply(`Usage: /previewcaption TYPE[:SYMBOL]`);
    return;
  }
  await sendCaptionPreview(ctx, arg);
}
async function resetCaptionCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const arg = parts[1];
  const base = (arg || '').split(':')[0].toLowerCase();
  if (!templateEngine.DEFAULT_TEMPLATES[base]) {
    await ctx.reply(`Usage: /resetcaption TYPE[:SYMBOL]`);
    return;
  }
  await templatesDb.reset(arg);
  await ctx.reply(`Caption for "${arg}" reset to default.`);
}

async function variablesCmd(ctx) {
  await inlineReply(ctx, menu.variablesHelp(templateEngine.VARIABLE_DOCS));
}
async function variablesScreen(ctx) {
  await inlineEdit(ctx, menu.variablesHelp(templateEngine.VARIABLE_DOCS));
}
async function varsManageScreen(ctx) {
  await inlineEdit(ctx, menu.varsList(await customVarsDb.getAll()));
}
async function varAddStart(ctx) {
  const prompt = 'Send: name value (name: letters/numbers/underscore only)\nExample: tagline to the moon';
  pendingInput.set('addvar', {}, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function varDelBtn(ctx, name) {
  await customVarsDb.remove(name);
  await ctx.answerCbQuery('Removed');
  await varsManageScreen(ctx);
}
async function setVarCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  await runSetVar(ctx, parts[1], parts.slice(2).join(' '));
}
async function runSetVar(ctx, name, value) {
  if (!name || !value || !/^[a-zA-Z0-9_]+$/.test(name)) {
    await ctx.reply('Usage: /setvar name value (name: letters/numbers/underscore only)\nExample: /setvar tagline "to the moon"');
    return;
  }
  if (templateEngine.buildVariables({ coin: config.coins[0], price: 1 })[name] !== undefined) {
    await ctx.reply(`"${name}" is a built-in variable name and can't be overridden.`);
    return;
  }
  await customVarsDb.set(name, value);
  await ctx.reply(`{${name}} is now available in captions \u2192 "${value}"`);
}
async function delVarCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  if (!parts[1]) {
    await ctx.reply('Usage: /delvar name');
    return;
  }
  await customVarsDb.remove(parts[1]);
  await ctx.reply(`{${parts[1]}} removed.`);
}

// ---------------------------------------------------------------------------
// Automation: schedules & rules (now with digest kind, edit, magnitude condition)
// ---------------------------------------------------------------------------
async function automationHubScreen(ctx) {
  await inlineEdit(ctx, menu.automationHub());
}
async function schedulesScreen(ctx) {
  await inlineEdit(ctx, menu.scheduleList(await schedulesDb.getAll()));
}
async function schedulesListCmd(ctx) {
  await inlineReply(ctx, menu.scheduleList(await schedulesDb.getAll()));
}
async function scheduleAddStart(ctx) {
  const prompt =
    'Send: <post|chart|digest> [SYMBOL] [period] CHANNEL <hourly|daily|weekly> HH:MM [dayOfWeek 0-6]\n\n' +
    'Examples:\n' +
    'post BTC main daily 09:00\n' +
    'chart ETH 24h vip daily 18:30\n' +
    'digest main weekly 09:00 0  (0=Sunday)\n' +
    'post SOL news weekly 12:00 1  (1=Monday)';
  pendingInput.set('addschedule', {}, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function scheduleCmd(ctx) {
  const rest = ctx.message.text.replace(/^\/schedule\s*/, '').trim();
  await runAddSchedule(ctx, rest.split(/\s+/));
}
async function runAddSchedule(ctx, parts, editId = null) {
  const kind = (parts[0] || '').toLowerCase();
  if (!['post', 'chart', 'digest'].includes(kind)) {
    await ctx.reply('First word must be "post", "chart", or "digest". See /schedule with no args for the format.');
    return;
  }
  let idx = 1;
  let symbol = 'ALL';
  let period = null;
  if (kind !== 'digest') {
    symbol = (parts[idx++] || '').toUpperCase();
    if (!findCoin(symbol)) {
      await ctx.reply(`Unknown symbol: ${symbol}`);
      return;
    }
  }
  if (kind === 'chart') {
    period = parts[idx++];
    if (!chartRenderer.PERIOD_PRESETS[period]) {
      await ctx.reply(`Unknown chart period "${period}". Choose one of: ${Object.keys(chartRenderer.PERIOD_PRESETS).join(', ')}`);
      return;
    }
  }
  const channelName = parts[idx++];
  const channel = await channelsDb.get(channelName);
  if (!channel) {
    await ctx.reply(`Unknown channel "${channelName}". /channels to see the list.`);
    return;
  }
  const cadence = (parts[idx++] || '').toLowerCase();
  if (!['hourly', 'daily', 'weekly'].includes(cadence)) {
    await ctx.reply('Cadence must be hourly, daily, or weekly.');
    return;
  }
  const timeStr = parts[idx++] || '';
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    await ctx.reply('Time must be HH:MM (UTC), e.g. 09:00');
    return;
  }
  const atHourUtc = Number(timeMatch[1]);
  const atMinuteUtc = Number(timeMatch[2]);
  let dayOfWeek = null;
  if (cadence === 'weekly') {
    dayOfWeek = Number(parts[idx++]);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      await ctx.reply('Weekly schedules need a day of week 0-6 (0=Sunday) as the last value.');
      return;
    }
  }

  const fields = { kind, symbol, period, channelName: channel.name, cadence, atMinuteUtc, atHourUtc, dayOfWeek };
  if (editId) {
    await schedulesDb.remove(editId);
    const id = await schedulesDb.add(fields);
    await ctx.reply(`Schedule updated (now #${id}).`);
  } else {
    const id = await schedulesDb.add(fields);
    await ctx.reply(`Schedule #${id} created.`);
  }
}
async function scheduleDel(ctx, id) {
  const all = await schedulesDb.getAll();
  const s = all.find((x) => x.id === Number(id));
  await schedulesDb.remove(Number(id));
  if (s) {
    const undoId = undoStack.push(`removed schedule #${id}`, async () =>
      schedulesDb.add({
        kind: s.kind,
        symbol: s.symbol,
        period: s.period,
        channelName: s.channelName,
        cadence: s.cadence,
        atMinuteUtc: s.atMinuteUtc,
        atHourUtc: s.atHourUtc,
        dayOfWeek: s.dayOfWeek,
      })
    );
    await ctx.answerCbQuery('Removed');
    await ctx.reply(`Schedule #${id} removed.`, {
      reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
    });
  } else {
    await ctx.answerCbQuery('Removed');
  }
  await schedulesScreen(ctx);
}
async function scheduleEditStart(ctx, id) {
  const all = await schedulesDb.getAll();
  const s = all.find((x) => x.id === Number(id));
  if (!s) {
    await ctx.answerCbQuery('Not found');
    return;
  }
  const timeStr = `${String(s.atHourUtc || 0).padStart(2, '0')}:${String(s.atMinuteUtc).padStart(2, '0')}`;
  const line =
    s.kind === 'digest'
      ? `digest ${s.channelName} ${s.cadence} ${timeStr}${s.cadence === 'weekly' ? ` ${s.dayOfWeek}` : ''}`
      : `${s.kind} ${s.symbol}${s.kind === 'chart' ? ` ${s.period}` : ''} ${s.channelName} ${s.cadence} ${timeStr}${
          s.cadence === 'weekly' ? ` ${s.dayOfWeek}` : ''
        }`;
  const prompt = `Editing schedule #${id}. Current:\n${line}\n\nSend the corrected line to replace it, or /cancel to leave it as-is.`;
  pendingInput.set('editschedule', { id: Number(id) }, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}

async function rulesScreen(ctx) {
  await inlineEdit(ctx, menu.ruleList(await rulesDb.getAll()));
}
async function rulesListCmd(ctx) {
  await inlineReply(ctx, menu.ruleList(await rulesDb.getAll()));
}
async function ruleAddStart(ctx) {
  const prompt =
    'Send: <threshold|milestone|any_alert>[:SYMBOL] <mirror|post_chart|broadcast> CHANNEL [min:PCT] [period|message...]\n\n' +
    'Examples:\n' +
    'milestone:BTC mirror vip\n' +
    'threshold post_chart main min:5 1h  (only when the move is 5%+)\n' +
    'any_alert broadcast news \uD83D\uDEA8 {symbol} just moved!';
  pendingInput.set('addrule', {}, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function ruleCmd(ctx) {
  const rest = ctx.message.text.replace(/^\/addrule\s*/, '');
  await runAddRule(ctx, rest);
}
async function runAddRule(ctx, rawText, editId = null) {
  const parts = rawText.trim().split(/\s+/);
  const triggerRaw = parts[0] || '';
  const [triggerType, triggerSymbol] = triggerRaw.split(':');
  if (!['threshold', 'milestone', 'any_alert'].includes(triggerType)) {
    await ctx.reply('Trigger must be threshold, milestone, or any_alert (optionally :SYMBOL).');
    return;
  }
  const actionType = parts[1];
  if (!['mirror', 'post_chart', 'broadcast'].includes(actionType)) {
    await ctx.reply('Action must be mirror, post_chart, or broadcast.');
    return;
  }
  const channelName = parts[2];
  const channel = await channelsDb.get(channelName);
  if (!channel) {
    await ctx.reply(`Unknown channel "${channelName}". /channels to see the list.`);
    return;
  }

  let idx = 3;
  let minMovePct = null;
  if (parts[idx] && /^min:\d+(\.\d+)?$/.test(parts[idx])) {
    minMovePct = Number(parts[idx].split(':')[1]);
    idx += 1;
  }

  const actionParams = { channel: channel.name };
  if (actionType === 'post_chart') {
    actionParams.period = parts[idx] || '24h';
    if (!chartRenderer.PERIOD_PRESETS[actionParams.period]) {
      await ctx.reply(`Unknown chart period "${actionParams.period}".`);
      return;
    }
  } else if (actionType === 'broadcast') {
    actionParams.message = parts.slice(idx).join(' ');
    if (!actionParams.message) {
      await ctx.reply('Broadcast rules need a message after the channel name (and min:X, if used).');
      return;
    }
  }

  const fields = {
    triggerType,
    triggerSymbol: triggerSymbol ? triggerSymbol.toUpperCase() : null,
    actionType,
    actionParams,
    minMovePct,
  };
  if (editId) {
    await rulesDb.remove(editId);
    const id = await rulesDb.add(fields);
    await ctx.reply(`Rule updated (now #${id}).`);
  } else {
    const id = await rulesDb.add(fields);
    await ctx.reply(`Rule #${id} created${minMovePct !== null ? ` (min move ${minMovePct}%)` : ''}.`);
  }
}
async function ruleDel(ctx, id) {
  const all = await rulesDb.getAll();
  const r = all.find((x) => x.id === Number(id));
  await rulesDb.remove(Number(id));
  if (r) {
    const undoId = undoStack.push(`removed rule #${id}`, async () =>
      rulesDb.add({
        triggerType: r.triggerType,
        triggerSymbol: r.triggerSymbol,
        actionType: r.actionType,
        actionParams: r.actionParams,
        minMovePct: r.minMovePct,
      })
    );
    await ctx.answerCbQuery('Removed');
    await ctx.reply(`Rule #${id} removed.`, {
      reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
    });
  } else {
    await ctx.answerCbQuery('Removed');
  }
  await rulesScreen(ctx);
}
async function ruleEditStart(ctx, id) {
  const all = await rulesDb.getAll();
  const r = all.find((x) => x.id === Number(id));
  if (!r) {
    await ctx.answerCbQuery('Not found');
    return;
  }
  const trigger = r.triggerSymbol ? `${r.triggerType}:${r.triggerSymbol}` : r.triggerType;
  const minPart = r.minMovePct !== null && r.minMovePct !== undefined ? ` min:${r.minMovePct}` : '';
  const extra = r.actionType === 'post_chart' ? ` ${r.actionParams.period || '24h'}` : r.actionType === 'broadcast' ? ` ${r.actionParams.message || ''}` : '';
  const line = `${trigger} ${r.actionType} ${r.actionParams.channel}${minPart}${extra}`;
  const prompt = `Editing rule #${id}. Current:\n${line}\n\nSend the corrected line to replace it, or /cancel to leave it as-is.`;
  pendingInput.set('editrule', { id: Number(id) }, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------
async function broadcastCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const channelName = parts[1];
  const message = parts.slice(2).join(' ');
  await runBroadcast(ctx, channelName, message);
}
async function runBroadcast(ctx, channelName, message) {
  if (!channelName || !message) {
    await ctx.reply('Usage: /broadcast CHANNEL message text here');
    return;
  }
  const result = await actions.broadcastMessage(ctx.telegram, channelName, message);
  await ctx.reply(result.message);
}

// ---------------------------------------------------------------------------
// Export / import config
// ---------------------------------------------------------------------------
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
async function exportConfigCmd(ctx) {
  const [thresholdsMap, milestoneMap, cooldownMap, channels, defaultsByType, captionTemplates, customVars, schedules, rules] =
    await Promise.all([
      thresholdsDb.getAll(),
      milestonesDb.getAll(),
      cooldownsDb.getAll(),
      channelsDb.getAll(),
      channelsDb.getDefaultsByType(),
      templatesDb.getAll(),
      customVarsDb.getAll(),
      schedulesDb.getAll(),
      rulesDb.getAll(),
    ]);

  const milestoneOverrides = {};
  for (const [symbol, v] of milestoneMap.entries()) {
    if (v.isCustom || v.isDisabled) milestoneOverrides[symbol] = { step: v.step, disabled: v.isDisabled };
  }

  const exportObj = {
    version: require('../../package.json').version,
    exportedAt: new Date().toISOString(),
    thresholds: thresholdsMap,
    milestoneOverrides,
    cooldownOverrides: cooldownMap,
    channels: channels.map((c) => ({ name: c.name, chatId: c.chatId })),
    defaultChannelsByType: defaultsByType,
    captionTemplates,
    customVars,
    schedules: schedules.map((s) => ({
      kind: s.kind,
      symbol: s.symbol,
      period: s.period,
      channelName: s.channelName,
      cadence: s.cadence,
      atMinuteUtc: s.atMinuteUtc,
      atHourUtc: s.atHourUtc,
      dayOfWeek: s.dayOfWeek,
    })),
    rules: rules.map((r) => ({
      triggerType: r.triggerType,
      triggerSymbol: r.triggerSymbol,
      actionType: r.actionType,
      actionParams: r.actionParams,
      minMovePct: r.minMovePct,
    })),
  };

  const buffer = Buffer.from(JSON.stringify(exportObj, null, 2), 'utf8');
  await ctx.replyWithDocument(Input.fromBuffer(buffer, `priceping-config-${todayStr()}.json`), {
    caption: 'Config export. Use /importconfig, then paste this JSON as your next message to restore it.',
  });
}
async function importConfigCmd(ctx) {
  const prompt = 'Paste the exported JSON config as your next message.';
  pendingInput.set('importconfig', {}, prompt);
  await ctx.reply(prompt);
}
async function backupMenuScreen(ctx) {
  await inlineEdit(ctx, menu.backupMenu());
}
async function exportConfigButton(ctx) {
  await ctx.answerCbQuery('Exporting...');
  await exportConfigCmd(ctx);
}
async function importConfigButton(ctx) {
  await ctx.answerCbQuery();
  await importConfigCmd(ctx);
}
async function runImportConfig(ctx, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    await ctx.reply(`Invalid JSON: ${err.message}`);
    return;
  }
  const report = [];

  async function section(name, fn) {
    try {
      const count = await fn();
      report.push(`${name}: ${count}`);
    } catch (err) {
      report.push(`${name} FAILED: ${err.message}`);
    }
  }

  if (data.thresholds) {
    await section('thresholds', async () => {
      for (const [symbol, t] of Object.entries(data.thresholds)) await thresholdsDb.set(symbol, t.value, t.type);
      return Object.keys(data.thresholds).length;
    });
  }
  if (data.milestoneOverrides) {
    await section('milestones', async () => {
      for (const [symbol, m] of Object.entries(data.milestoneOverrides)) {
        if (m.disabled) await milestonesDb.disable(symbol);
        else await milestonesDb.set(symbol, m.step);
      }
      return Object.keys(data.milestoneOverrides).length;
    });
  }
  if (data.cooldownOverrides) {
    await section('cooldowns', async () => {
      for (const [symbol, mins] of Object.entries(data.cooldownOverrides)) await cooldownsDb.set(symbol, mins);
      return Object.keys(data.cooldownOverrides).length;
    });
  }
  if (data.channels) {
    await section('channels', async () => {
      for (const c of data.channels) if (c.name !== 'main') await channelsDb.add(c.name, c.chatId);
      return data.channels.length;
    });
  }
  if (data.defaultChannelsByType) {
    await section('default channels by type', async () => {
      for (const [type, name] of Object.entries(data.defaultChannelsByType)) await channelsDb.setDefaultForType(type, name);
      return Object.keys(data.defaultChannelsByType).length;
    });
  }
  if (data.captionTemplates) {
    await section('captions', async () => {
      for (const [key, tpl] of Object.entries(data.captionTemplates)) await templatesDb.set(key, tpl);
      return Object.keys(data.captionTemplates).length;
    });
  }
  if (data.customVars) {
    await section('vars', async () => {
      for (const [name, val] of Object.entries(data.customVars)) await customVarsDb.set(name, val);
      return Object.keys(data.customVars).length;
    });
  }
  if (data.schedules) {
    await section('schedules', async () => {
      for (const s of data.schedules) await schedulesDb.add(s);
      return data.schedules.length;
    });
  }
  if (data.rules) {
    await section('rules', async () => {
      for (const r of data.rules) await rulesDb.add(r);
      return data.rules.length;
    });
  }

  await ctx.reply(`Import complete:\n${report.join('\n') || 'nothing recognized in that JSON'}`);
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
async function resetCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const type = (parts[1] || '').toLowerCase();
  if (!type) {
    await inlineReply(ctx, menu.resetMenu());
    return;
  }
  await inlineReply(ctx, menu.resetConfirm(type));
}
async function resetMenuScreen(ctx) {
  await inlineEdit(ctx, menu.resetMenu());
}
async function resetConfirmScreen(ctx, type) {
  await inlineEdit(ctx, menu.resetConfirm(type));
}

const RESET_HANDLERS = {
  thresholds: async () => {
    for (const [symbol, value] of Object.entries(config.defaultThresholds)) await thresholdsDb.set(symbol, value, 'usd');
  },
  milestones: async () => milestonesDb.clearAll(),
  cooldowns: async () => cooldownsDb.clearAll(),
  captions: async () => {
    const all = await templatesDb.getAll();
    for (const key of Object.keys(all)) await templatesDb.reset(key);
  },
  vars: async () => {
    const all = await customVarsDb.getAll();
    for (const name of Object.keys(all)) await customVarsDb.remove(name);
  },
  channels: async () => {
    const all = await channelsDb.getAll();
    for (const c of all) if (c.name !== 'main') await channelsDb.remove(c.name);
    await channelsDb.setDefault('main');
    const byType = await channelsDb.getDefaultsByType();
    for (const t of Object.keys(byType)) await channelsDb.clearDefaultForType(t);
  },
  automation: async () => {
    const scheds = await schedulesDb.getAll();
    for (const s of scheds) await schedulesDb.remove(s.id);
    const rls = await rulesDb.getAll();
    for (const r of rls) await rulesDb.remove(r.id);
  },
};

async function resetExecute(ctx, type) {
  await ctx.answerCbQuery('Resetting...');
  if (type === 'everything') {
    for (const fn of Object.values(RESET_HANDLERS)) await fn();
  } else if (RESET_HANDLERS[type]) {
    await RESET_HANDLERS[type]();
  } else {
    await ctx.reply('Unknown reset type.');
    return;
  }
  await ctx.reply(`Reset complete: ${type}.`);
}

// ---------------------------------------------------------------------------
// Whoami / digest-now
// ---------------------------------------------------------------------------
async function whoami(ctx) {
  await ctx.reply(
    `You are ${config.adminName} (Telegram ID ${config.adminId}).\n` +
      `Chat ID: ${ctx.chat.id}\n` +
      `Bot: ${config.botName} v${require('../../package.json').version}`
  );
}
async function whoamiButton(ctx) {
  await ctx.answerCbQuery();
  await whoami(ctx);
}

async function digestNowCmd(ctx) {
  const digest = require('../services/digest');
  await ctx.reply('Sending digest now...');
  try {
    const [priceMap, statsMap] = await Promise.all([marketData.fetchAllPrices(), marketData.fetchAll24hrStats()]);
    const message = digest.buildDigestMessage(priceMap, statsMap);
    await ctx.telegram.sendMessage(config.channelId, message, { parse_mode: 'HTML' });
    await ctx.reply('Digest posted.');
  } catch (err) {
    await ctx.reply(`Could not send digest: ${err.message}`);
  }
}
async function digestNowButton(ctx) {
  await ctx.answerCbQuery('Sending...');
  await digestNowCmd(ctx);
}

// ---------------------------------------------------------------------------
// Advanced /test
// ---------------------------------------------------------------------------
async function testAlert(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  if ((parts[1] || '').toLowerCase() === 'fail') {
    return testFailure(ctx, (parts[2] || '').toLowerCase());
  }
  const symbol = (parts[1] || '').toUpperCase();
  if (!symbol) {
    await inlineReply(ctx, menu.testPicker(recentCoins.getRecent()));
    return;
  }
  await sendTestAlert(ctx, symbol);
}

async function sendTestAlert(ctx, symbol) {
  const coin = findCoin(symbol);
  if (!coin) {
    await ctx.reply(`Unknown symbol: ${symbol}`);
    return;
  }
  const channel = await channelsDb.getDefault();
  if (!channel) {
    await ctx.reply('No default channel configured — use /addchannel and /setdefaultchannel first.');
    return;
  }
  let price;
  try {
    price = (await marketData.fetchAllPrices()).get(symbol);
  } catch {
    /* fall through to fallback */
  }
  if (price === undefined) price = 100;

  const alert = {
    coin,
    price,
    changeUsd: coin.isStable ? 0 : 12.5,
    changePct: coin.isStable ? 0 : 1.2,
    direction: 'up',
    alertType: 'threshold',
    threshold: { value: 1, type: 'pct' },
  };
  const sent = await telegramSender.sendAlert(ctx.telegram, alert, channel);
  await ctx.reply(sent ? `Test alert sent to #${channel.name} for ${symbol}.` : `Could not send test alert for ${symbol}.`);
}

async function testTypeScreen(ctx, symbol) {
  await inlineEdit(ctx, menu.testTypePicker(symbol));
}
async function testTypeChosen(ctx, symbol, type) {
  if (type === 'manual' || type === 'chart') {
    await testDestinationScreen(ctx, symbol, type, 'na');
  } else {
    await inlineEdit(ctx, menu.testValuePicker(symbol, type));
  }
}

const VALUE_PRESETS = { plus2: 2, minus5: -5, plus10: 10 };

async function testDestinationScreen(ctx, symbol, type, valueCode) {
  const channels = await channelsDb.getAll();
  await inlineEdit(ctx, menu.testDestinationPicker(symbol, type, valueCode, channels, recentCoins.getLastTestDestination()));
}

async function testExecute(ctx, symbol, type, valueCode, dest) {
  await ctx.answerCbQuery('Running test...');
  const coin = findCoin(symbol);
  if (!coin) {
    await ctx.reply(`Unknown symbol: ${symbol}`);
    return;
  }

  recentCoins.noteCoin(symbol);
  recentCoins.noteTestDestination(dest);

  const channel = dest === 'preview' ? { name: 'preview (you)', chatId: ctx.chat.id } : await channelsDb.get(dest);
  if (!channel) {
    await ctx.reply(`Unknown destination: ${dest}`);
    return;
  }

  let realPrice;
  try {
    realPrice = (await marketData.fetchAllPrices()).get(symbol);
  } catch {
    /* fallback below */
  }
  if (realPrice === undefined) realPrice = 100;

  const pct = VALUE_PRESETS[valueCode] || 2;
  const simPrice = realPrice * (1 + pct / 100);

  try {
    if (type === 'threshold') {
      const threshold = (await thresholdsDb.get(symbol)) || { value: 1, type: 'pct' };
      const alert = {
        coin,
        price: simPrice,
        changeUsd: simPrice - realPrice,
        changePct: pct,
        direction: pct >= 0 ? 'up' : 'down',
        alertType: 'threshold',
        threshold,
        cooldownRemainingMs: config.cooldownMinutes * 60000,
      };
      const sent = await telegramSender.sendAlert(ctx.telegram, alert, channel);
      await ctx.reply(sent ? `Test threshold alert sent to #${channel.name}.` : 'Test send failed.');
    } else if (type === 'milestone') {
      const step = await milestonesDb.getEffectiveStep(symbol);
      if (!step) {
        await ctx.reply(`${symbol} has no milestone step configured — nothing to simulate.`);
        return;
      }
      const level = pct >= 0 ? (Math.floor(realPrice / step) + 1) * step : (Math.floor(realPrice / step) - 1) * step;
      const alert = { coin, price: level, changeUsd: null, changePct: null, direction: pct >= 0 ? 'up' : 'down', alertType: 'milestone', milestoneLevel: level };
      const sent = await telegramSender.sendAlert(ctx.telegram, alert, channel);
      await ctx.reply(sent ? `Test milestone alert sent to #${channel.name}.` : 'Test send failed.');
    } else if (type === 'manual') {
      let stats24h = null;
      let candles = [];
      if (!coin.isStable) {
        [stats24h, candles] = await Promise.all([
          marketData.fetch24hrForSymbol(symbol).catch(() => null),
          marketData.fetchKlinesForSymbol(symbol, '15m', 96).catch(() => []),
        ]);
      }
      const sent = await telegramSender.sendManualPost(ctx.telegram, { coin, price: realPrice, stats24h, candles, alertCountToday: 0 }, channel);
      await ctx.reply(sent ? `Test manual post sent to #${channel.name}.` : 'Test send failed.');
    } else if (type === 'chart') {
      const preset = chartRenderer.PERIOD_PRESETS['24h'];
      const candles = await marketData.fetchKlinesForSymbol(symbol, preset.interval, preset.limit);
      if (candles.length < 2) {
        await ctx.reply('Not enough data to chart right now.');
        return;
      }
      const buffer = await chartRenderer.renderChart({ coin, candles, periodKey: '24h' });
      const sent = await telegramSender.sendChart(ctx.telegram, { coin, buffer, periodLabel: preset.label }, channel);
      await ctx.reply(sent ? `Test chart sent to #${channel.name}.` : 'Test send failed.');
    }
  } catch (err) {
    logger.warn('Test execution failed', { message: err.message });
    await ctx.reply(`Test failed: ${err.message}`);
  }
}

async function testFull(ctx) {
  await ctx.answerCbQuery('Running full check...');
  await ctx.reply('Running full pipeline check (previews to you only)...');

  const coin = findCoin('BTC') || config.coins[0];
  const previewChannel = { name: 'preview (you)', chatId: ctx.chat.id };
  const results = [];

  let realPrice = 100;
  try {
    realPrice = (await marketData.fetchAllPrices()).get(coin.symbol) ?? 100;
  } catch {
    /* use fallback */
  }

  async function step(label, fn) {
    try {
      const ok = await fn();
      results.push(`${ok ? '\u2705' : '\u274C'} ${label}`);
    } catch (err) {
      results.push(`\u274C ${label} \u2014 ${err.message}`);
    }
  }

  await step('Threshold alert render + send', async () => {
    const threshold = (await thresholdsDb.get(coin.symbol)) || { value: 1, type: 'pct' };
    return telegramSender.sendAlert(
      ctx.telegram,
      { coin, price: realPrice * 1.02, changeUsd: realPrice * 0.02, changePct: 2, direction: 'up', alertType: 'threshold', threshold, cooldownRemainingMs: 300000 },
      previewChannel
    );
  });

  await step('Milestone alert render + send', async () => {
    const step_ = await milestonesDb.getEffectiveStep(coin.symbol);
    if (!step_) return true; // nothing to test for this coin, not a failure
    const level = (Math.floor(realPrice / step_) + 1) * step_;
    return telegramSender.sendAlert(
      ctx.telegram,
      { coin, price: level, changeUsd: null, changePct: null, direction: 'up', alertType: 'milestone', milestoneLevel: level },
      previewChannel
    );
  });

  await step('Manual post render + send', async () => {
    const stats24h = { priceChangePercent: 1.5, highPrice: realPrice * 1.02, lowPrice: realPrice * 0.98, openPrice: realPrice, quoteVolume: 1000000 };
    return telegramSender.sendManualPost(ctx.telegram, { coin, price: realPrice, stats24h, candles: [], alertCountToday: 0 }, previewChannel);
  });

  await step('Chart render + send', async () => {
    const preset = chartRenderer.PERIOD_PRESETS['24h'];
    const candles = await marketData.fetchKlinesForSymbol(coin.symbol, preset.interval, preset.limit);
    if (candles.length < 2) return false;
    const buffer = await chartRenderer.renderChart({ coin, candles, periodKey: '24h' });
    return telegramSender.sendChart(ctx.telegram, { coin, buffer, periodLabel: preset.label }, previewChannel);
  });

  await step('Digest message build + send', async () => {
    const digest = require('../services/digest');
    const [priceMap, statsMap] = await Promise.all([marketData.fetchAllPrices(), marketData.fetchAll24hrStats()]);
    const message = digest.buildDigestMessage(priceMap, statsMap);
    return telegramSender.sendMessageWithRetry(ctx.telegram, ctx.chat.id, message);
  });

  await ctx.reply(`Pipeline check results\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${results.join('\n')}`);
}

async function testFailure(ctx, kind) {
  if (kind === 'binance') {
    try {
      await binance.fetchPrices(['THISISNOTAREALPAIR']);
      await ctx.reply('Unexpected: that call should have failed. Check binance.js.');
    } catch (err) {
      await eventsDb.record('test_binance_failure', err.message);
      await ctx.reply(`Binance failure path confirmed working \u2014 caught: ${err.message}`);
    }
    return;
  }
  if (kind === 'telegram') {
    const coin = findCoin('BTC') || config.coins[0];
    const buffer = await cardRenderer.renderCard({ coin, price: 100, changeUsd: 1, changePct: 1, direction: 'up', alertType: 'threshold' });
    const sent = await telegramSender.sendPhotoWithRetry(ctx.telegram, 'INVALID_CHAT_ID_FOR_TEST', buffer, 'test.png', 'test');
    await ctx.reply(
      sent
        ? 'Unexpected: send to an invalid chat ID succeeded. Check telegramSender.js.'
        : 'Telegram failure path confirmed working \u2014 retry-then-log-and-move-on behaved as expected.'
    );
    return;
  }
  await ctx.reply('Usage: /test fail binance | /test fail telegram');
}

async function runSetExactThreshold(ctx, symbol, text) {
  const trimmed = text.trim();
  let amountRaw = trimmed;
  let type = 'usd';
  if (amountRaw.endsWith('%')) {
    type = 'pct';
    amountRaw = amountRaw.slice(0, -1);
  } else if (/\bpct\b/i.test(amountRaw)) {
    type = 'pct';
    amountRaw = amountRaw.replace(/pct/i, '').trim();
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply('That doesn\'t look like a valid amount. Send e.g. 400 or 2%');
    return;
  }
  const previous = await thresholdsDb.get(symbol);
  await thresholdsDb.set(symbol, amount, type);
  const undoId = undoStack.push(`${symbol} threshold`, async () => {
    if (previous) await thresholdsDb.set(symbol, previous.value, previous.type);
  });
  let warning = '';
  const referenceDefault = config.defaultThresholds[symbol];
  if (referenceDefault && type === 'usd' && amount > referenceDefault * 50) {
    warning = `\n\u26A0\uFE0F That's ${Math.round(amount / referenceDefault)}\u00D7 the typical default for ${symbol} \u2014 double check this was intentional.`;
  }
  await ctx.reply(`${symbol} threshold set to ${type === 'pct' ? `${amount}%` : `$${amount}`}.${warning}`, {
    reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
  });
}

async function runSetExactMilestone(ctx, symbol, text) {
  const trimmed = text.trim().toLowerCase();
  const priorMap = await milestonesDb.getAll();
  const prior = priorMap.get(symbol) || { step: null, isCustom: false, isDisabled: false };
  const undoFn = async () => {
    if (prior.isDisabled) await milestonesDb.disable(symbol);
    else if (prior.isCustom) await milestonesDb.set(symbol, prior.step);
    else await milestonesDb.clear(symbol);
  };

  if (trimmed === 'off') {
    await milestonesDb.disable(symbol);
    const undoId = undoStack.push(`${symbol} milestone`, undoFn);
    await ctx.reply(`${symbol} milestones turned off.`, {
      reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
    });
    return;
  }
  const step = Number(trimmed);
  if (!Number.isFinite(step) || step <= 0) {
    await ctx.reply('That doesn\'t look like a valid step. Send a positive number, or "off".');
    return;
  }
  await milestonesDb.set(symbol, step);
  const undoId = undoStack.push(`${symbol} milestone`, undoFn);
  await ctx.reply(`${symbol} milestone step set to $${format.formatChangeUsd(step)}.`, {
    reply_markup: { inline_keyboard: [[{ text: '\u21A9 Undo', callback_data: `undo:${undoId}` }]] },
  });
}

// ---------------------------------------------------------------------------
// Guided text-input dispatcher — see services/pendingInput.js
// ---------------------------------------------------------------------------
async function handleGuidedInput(ctx, pending) {
  const text = ctx.message.text.trim();

  if (text === '/cancel') {
    await ctx.reply('Cancelled.');
    return;
  }

  const parts = text.split(/\s+/);

  if (pending.action === 'addcoin') return stageAddCoin(ctx, parts);
  if (pending.action === 'addchannel') return runAddChannel(ctx, parts);
  if (pending.action === 'addvar') return runSetVar(ctx, parts[0], parts.slice(1).join(' '));
  if (pending.action === 'addschedule') return runAddSchedule(ctx, parts);
  if (pending.action === 'editschedule') return runAddSchedule(ctx, parts, pending.context.id);
  if (pending.action === 'addrule') return runAddRule(ctx, text);
  if (pending.action === 'editrule') return runAddRule(ctx, text, pending.context.id);
  if (pending.action === 'setcaption') return runSetCaption(ctx, pending.context.alertType, text);
  if (pending.action === 'broadcast') return runBroadcast(ctx, pending.context.channelName, text);
  if (pending.action === 'importconfig') return runImportConfig(ctx, text);
  if (pending.action === 'setexactthreshold') return runSetExactThreshold(ctx, pending.context.symbol, text);
  if (pending.action === 'setexactmilestone') return runSetExactMilestone(ctx, pending.context.symbol, text);

  await ctx.reply("Sorry, I lost track of what you were entering — please tap the button again.");
}

module.exports = {
  start,
  help,
  home,
  hubCmd,
  pricesCmd,
  statsCmd,
  settingsCmd,
  pinManageScreen,
  pinToggle,
  thresholdsCmd,
  thresholdAdjust,
  setThreshold,
  undoThreshold,
  undoExecute,
  coinSettingsMenuScreen,
  coinSettingsScreen,
  milestonesScreen,
  milestonesCmd,
  milestoneAdjust,
  milestoneToggle,
  setMilestoneCmd,
  milestoneSetExactStart,
  thresholdSetExactStart,
  cooldownAdjust,
  cooldownResetBtn,
  setCooldownCmd,
  resetCooldownCmd,
  pause,
  resume,
  pauseMenuScreen,
  pauseApply,
  mute,
  unmute,
  muteMenuScreen,
  muteDurationScreen,
  muteApply,
  muteClear,
  postMenuScreen,
  postChannelScreen,
  postExecute,
  postCmd,
  manualPost,
  chartMenuScreen,
  chartPeriodScreen,
  chartChannelScreen,
  chartSendExecute,
  chartPreviewExecute,
  chartCmd,
  postChartCmd,
  addCoinCmd,
  addCoinStart,
  addCoinConfirmExecute,
  addCoinCancel,
  historyCmd,
  historyMenuScreen,
  historyCoinScreen,
  channelsScreen,
  channelsListCmd,
  channelAddStart,
  addChannelCmd,
  removeChannelCmd,
  channelDel,
  setDefaultChannelCmd,
  clearDefaultChannelTypeCmd,
  channelSetDefault,
  channelTypeDefaultScreen,
  channelTypeDefaultChannelScreen,
  channelSetTypeDefaultExecute,
  channelClearTypeDefault,
  broadcastMenuScreen,
  broadcastPick,
  captionTypesScreen,
  captionDetailScreen,
  captionEditStart,
  captionReset,
  captionPreview,
  captionOverridesScreen,
  captionCoinDetailScreen,
  captionCoinEditStart,
  captionCoinPreviewBtn,
  captionCoinResetBtn,
  setCaptionCmd,
  previewCaptionCmd,
  resetCaptionCmd,
  variablesCmd,
  variablesScreen,
  varsManageScreen,
  varAddStart,
  varDelBtn,
  setVarCmd,
  delVarCmd,
  automationHubScreen,
  schedulesScreen,
  schedulesListCmd,
  scheduleAddStart,
  scheduleCmd,
  scheduleDel,
  scheduleEditStart,
  rulesScreen,
  rulesListCmd,
  ruleAddStart,
  ruleCmd,
  ruleDel,
  ruleEditStart,
  broadcastCmd,
  exportConfigCmd,
  importConfigCmd,
  backupMenuScreen,
  exportConfigButton,
  importConfigButton,
  resetCmd,
  resetMenuScreen,
  resetConfirmScreen,
  resetExecute,
  whoami,
  whoamiButton,
  digestNowCmd,
  digestNowButton,
  testAlert,
  sendTestAlert,
  testTypeScreen,
  testTypeChosen,
  testDestinationScreen,
  testExecute,
  testFull,
  testFailure,
  handleGuidedInput,
};
