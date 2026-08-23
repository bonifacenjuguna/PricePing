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

const marketData = require('../services/marketData');
const binance = require('../services/binance');
const telegramSender = require('../services/telegramSender');
const chartRenderer = require('../services/chartRenderer');
const cardRenderer = require('../services/cardRenderer');
const coinRegistry = require('../services/coinRegistry');
const templateEngine = require('../services/templateEngine');
const actions = require('../services/actions');
const pendingInput = require('../services/pendingInput');

const format = require('../utils/format');
const { parseDuration, formatRemaining } = require('../utils/duration');
const logger = require('../utils/logger');

const lastThresholdChange = new Map(); // symbol -> { value, type } — powers the Undo button

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
      `/pause [DURATION] / /resume\n` +
      `/mute SYMBOL [DURATION] / /unmute SYMBOL\n` +
      `/addcoin SYMBOL PAIR #COLOR [Name]\n` +
      `/history SYMBOL\n` +
      `/stats\n` +
      `/channels \u2014 list channels \u00B7 /addchannel name chat_id \u00B7 /removechannel name \u00B7 /setdefaultchannel name\n` +
      `/setcaption TYPE <template> \u00B7 /previewcaption TYPE \u00B7 /resetcaption TYPE\n` +
      `/variables \u2014 list caption variables \u00B7 /setvar name value \u00B7 /delvar name\n` +
      `/schedule <line> \u00B7 /schedules \u00B7 /addrule <line> \u00B7 /rules\n` +
      `/broadcast CHANNEL message... \u2014 plain text post\n` +
      `/test [SYMBOL] \u2014 advanced test menu\n` +
      `/whoami\n\n` +
      `Or type /commands for the full button-driven menu.`
  );
}

async function home(ctx) {
  const [paused, pausedUntil, alertsToday, [lastEvent], heartbeat] = await Promise.all([
    settingsDb.isPaused(),
    settingsDb.getPausedUntil(),
    alertsLogDb.countToday(),
    eventsDb.latest(1),
    heartbeatDb.get(),
  ]);
  await inlineReply(
    ctx,
    menu.home({ paused, pausedUntil, uptimeSeconds: process.uptime(), alertsToday, lastEvent: lastEvent || null, heartbeat })
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

async function thresholdEditScreen(ctx, symbol) {
  const t = await thresholdsDb.get(symbol);
  await inlineEdit(ctx, menu.thresholdEdit(symbol, t));
}

function thresholdStep(threshold) {
  if (!threshold) return { value: 1, type: 'usd' };
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
  await thresholdEditScreen(ctx, symbol);
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
  if (previous) lastThresholdChange.set(symbol, previous);
  await thresholdsDb.set(symbol, amount, type);

  const displayAmount = type === 'pct' ? `${amount}%` : `$${amount}`;
  const keyboard = previous ? [[{ text: '\u21A9 Undo', callback_data: `action:undothreshold:${symbol}` }]] : [];
  await ctx.reply(`Threshold for ${symbol} set to ${displayAmount}${type === 'pct' ? ' (of price)' : ''}.`, {
    reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
  });
}

async function undoThreshold(ctx, symbol) {
  const previous = lastThresholdChange.get(symbol);
  if (!previous) {
    await ctx.reply(`Nothing to undo for ${symbol}.`);
    return;
  }
  await thresholdsDb.set(symbol, previous.value, previous.type);
  lastThresholdChange.delete(symbol);
  const displayAmount = previous.type === 'pct' ? `${previous.value}%` : `$${previous.value}`;
  await ctx.reply(`Reverted ${symbol} threshold to ${displayAmount}.`);
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
  const text = 'Resumed \u2014 alerts will post as usual.';
  if (ctx.updateType === 'callback_query') {
    await ctx.answerCbQuery('Resumed');
    await home(ctx);
  } else {
    await ctx.reply(text);
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
  await inlineEdit(ctx, menu.muteMenu());
}
async function muteDurationScreen(ctx, symbol) {
  await inlineEdit(ctx, menu.muteDurationPicker(symbol));
}
async function muteApply(ctx, symbol, code) {
  const durationStr = DURATION_CODES[code];
  const ms = durationStr === null ? 100 * 365 * 24 * 60 * 60 * 1000 : parseDuration(durationStr); // "indefinite" = ~100 years
  await coinStateDb.setMuteUntil(symbol, new Date(Date.now() + ms));
  await ctx.answerCbQuery(`${symbol} muted`);
  await muteMenuScreen(ctx);
}
async function muteClear(ctx, symbol) {
  await coinStateDb.clearMute(symbol);
  await ctx.answerCbQuery(`${symbol} unmuted`);
  await muteMenuScreen(ctx);
}

// ---------------------------------------------------------------------------
// Post & chart — button flow + slash commands (both go through actions.js)
// ---------------------------------------------------------------------------
async function postMenuScreen(ctx) {
  await inlineEdit(ctx, menu.postMenu());
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
  await inlineEdit(ctx, menu.chartMenu());
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
// Coins
// ---------------------------------------------------------------------------
async function addCoinCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  await runAddCoin(ctx, parts.slice(1));
}

async function runAddCoin(ctx, parts) {
  const symbol = (parts[0] || '').toUpperCase();
  const pair = (parts[1] || '').toUpperCase();
  const color = parts[2] || '';
  const name = parts.slice(3).join(' ') || symbol;

  if (!symbol || !pair || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    await ctx.reply('Usage: SYMBOL BINANCEPAIR #HEXCOLOR [Name]\nExample: ADA ADAUSDT #0033AD Cardano');
    return;
  }
  try {
    const { logoSource } = await coinRegistry.addCoin({ symbol, name, binancePair: pair, color });
    await ctx.reply(
      `${symbol} added \u2014 tracking ${pair}. Logo ${logoSource === 'downloaded' ? 'downloaded' : 'using a plain fallback (re-run /addcoin logic later if you want the real one)'}.`
    );
  } catch (err) {
    await ctx.reply(`Could not add ${symbol}: ${err.message}`);
  }
}

async function historyCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  if (!findCoin(symbol)) {
    await ctx.reply('Usage: /history SYMBOL');
    return;
  }
  const rows = await alertsLogDb.recentForSymbol(symbol, 10);
  if (!rows.length) {
    await ctx.reply(`No alerts logged yet for ${symbol}.`);
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
  await inlineEdit(ctx, menu.channelList(await channelsDb.getAll()));
}
async function channelsListCmd(ctx) {
  await inlineReply(ctx, menu.channelList(await channelsDb.getAll()));
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
  await channelsDb.add(name, chatId);
  await ctx.reply(`Channel "${name}" added \u2192 ${chatId}. Use /setdefaultchannel ${name} to make it the default target.`);
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
  await ctx.answerCbQuery('Removed');
  await channelsScreen(ctx);
}
async function setDefaultChannelCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const name = parts[1];
  const channel = await channelsDb.get(name);
  if (!channel) {
    await ctx.reply(`No channel named "${name}". /channels to see the list.`);
    return;
  }
  await channelsDb.setDefault(name);
  await ctx.reply(`"${name}" is now the default channel for automatic alerts.`);
}
async function channelSetDefault(ctx, name) {
  await channelsDb.setDefault(name);
  await ctx.answerCbQuery(`${name} is now default`);
  await channelsScreen(ctx);
}

// ---------------------------------------------------------------------------
// Captions / templates / variables
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
  await templatesDb.reset(alertType);
  await ctx.answerCbQuery('Reset to default');
  await captionDetailScreen(ctx, alertType);
}
async function captionPreview(ctx, alertType) {
  await ctx.answerCbQuery('Rendering preview...');
  await sendCaptionPreview(ctx, alertType);
}

function sampleCoinFor(alertType) {
  return findCoin('BTC') || config.coins[0];
}

async function sendCaptionPreview(ctx, alertType) {
  const coin = sampleCoinFor(alertType);
  const sampleChannel = { name: 'preview', chatId: '@PricePing' };
  let ctxData;
  if (alertType === 'threshold') {
    ctxData = { coin, price: 109842.5, changeUsd: 512, changePct: 0.47, direction: 'up', alertType, threshold: { value: 400, type: 'usd' }, cooldownRemainingMs: 300000, channel: sampleChannel };
  } else if (alertType === 'milestone') {
    ctxData = { coin, price: 110032, changeUsd: null, changePct: null, direction: 'up', alertType, milestoneLevel: 110000, channel: sampleChannel };
  } else if (alertType === 'manual') {
    ctxData = { coin, price: 109842.5, direction: 'up', changePct: 1.8, stats24h: { priceChangePercent: 1.8, highPrice: 110500, lowPrice: 108200, openPrice: 108000, quoteVolume: 500000000 }, alertType: 'manual', changeSinceLastPost: 234.1, alertCountToday: 3, channel: sampleChannel };
  } else {
    ctxData = { coin, periodLabel: 'Last 24 hours', alertType: 'chart', channel: sampleChannel };
  }
  const rendered = await templateEngine.renderCaption(alertType, ctxData);
  await ctx.reply(`Preview (sample data):\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`, {});
  await ctx.reply(rendered, { parse_mode: 'HTML' });
}

async function setCaptionCmd(ctx) {
  const text = ctx.message.text.trim();
  const match = text.match(/^\/setcaption\s+(\S+)\s+([\s\S]+)$/);
  if (!match) {
    await ctx.reply('Usage: /setcaption TYPE <template>\nTypes: threshold, milestone, manual, chart');
    return;
  }
  await runSetCaption(ctx, match[1], match[2]);
}
async function runSetCaption(ctx, alertType, template) {
  const type = alertType.toLowerCase();
  if (!templateEngine.DEFAULT_TEMPLATES[type]) {
    await ctx.reply(`Unknown caption type "${alertType}". Choose one of: ${Object.keys(templateEngine.DEFAULT_TEMPLATES).join(', ')}`);
    return;
  }
  await templatesDb.set(type, template);
  await ctx.reply(`Caption for "${type}" updated. Use /previewcaption ${type} to see it rendered.`);
}
async function previewCaptionCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const type = (parts[1] || '').toLowerCase();
  if (!templateEngine.DEFAULT_TEMPLATES[type]) {
    await ctx.reply(`Usage: /previewcaption TYPE\nTypes: ${Object.keys(templateEngine.DEFAULT_TEMPLATES).join(', ')}`);
    return;
  }
  await sendCaptionPreview(ctx, type);
}
async function resetCaptionCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const type = (parts[1] || '').toLowerCase();
  if (!templateEngine.DEFAULT_TEMPLATES[type]) {
    await ctx.reply(`Usage: /resetcaption TYPE`);
    return;
  }
  await templatesDb.reset(type);
  await ctx.reply(`Caption for "${type}" reset to default.`);
}

async function variablesCmd(ctx) {
  await inlineReply(ctx, menu.variablesHelp(templateEngine.VARIABLE_DOCS));
}
async function variablesScreen(ctx) {
  await inlineEdit(ctx, menu.variablesHelp(templateEngine.VARIABLE_DOCS));
}

async function setVarCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const name = parts[1];
  const value = parts.slice(2).join(' ');
  await runSetVar(ctx, name, value);
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
  const name = parts[1];
  if (!name) {
    await ctx.reply('Usage: /delvar name');
    return;
  }
  await customVarsDb.remove(name);
  await ctx.reply(`{${name}} removed.`);
}

// ---------------------------------------------------------------------------
// Automation: schedules & rules
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
    'Send: <post|chart> SYMBOL [period] CHANNEL <hourly|daily|weekly> HH:MM [dayOfWeek 0-6]\n\n' +
    'Examples:\n' +
    'post BTC main daily 09:00\n' +
    'chart ETH 24h vip daily 18:30\n' +
    'chart BTC 1h main hourly 00:15\n' +
    'post SOL news weekly 12:00 1  (1=Monday)';
  pendingInput.set('addschedule', {}, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function scheduleCmd(ctx) {
  const rest = ctx.message.text.replace(/^\/schedule\s*/, '').trim();
  await runAddSchedule(ctx, rest.split(/\s+/));
}
async function runAddSchedule(ctx, parts) {
  const kind = (parts[0] || '').toLowerCase();
  if (kind !== 'post' && kind !== 'chart') {
    await ctx.reply('First word must be "post" or "chart". See /schedule with no args for the format.');
    return;
  }
  let idx = 1;
  const symbol = (parts[idx++] || '').toUpperCase();
  if (!findCoin(symbol)) {
    await ctx.reply(`Unknown symbol: ${symbol}`);
    return;
  }
  let period = null;
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

  const id = await schedulesDb.add({ kind, symbol, period, channelName: channel.name, cadence, atMinuteUtc, atHourUtc, dayOfWeek });
  await ctx.reply(`Schedule #${id} created.`);
}
async function scheduleDel(ctx, id) {
  await schedulesDb.remove(Number(id));
  await ctx.answerCbQuery('Removed');
  await schedulesScreen(ctx);
}

async function rulesScreen(ctx) {
  await inlineEdit(ctx, menu.ruleList(await rulesDb.getAll()));
}
async function rulesListCmd(ctx) {
  await inlineReply(ctx, menu.ruleList(await rulesDb.getAll()));
}
async function ruleAddStart(ctx) {
  const prompt =
    'Send: <threshold|milestone|any_alert>[:SYMBOL] <mirror|post_chart|broadcast> CHANNEL [period|message...]\n\n' +
    'Examples:\n' +
    'milestone:BTC mirror vip\n' +
    'threshold post_chart main 1h\n' +
    'any_alert broadcast news \uD83D\uDEA8 {symbol} just moved!';
  pendingInput.set('addrule', {}, prompt);
  await ctx.answerCbQuery();
  await ctx.reply(prompt);
}
async function ruleCmd(ctx) {
  const rest = ctx.message.text.replace(/^\/addrule\s*/, '');
  await runAddRule(ctx, rest);
}
async function runAddRule(ctx, rawText) {
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

  const actionParams = { channel: channel.name };
  if (actionType === 'post_chart') {
    actionParams.period = parts[3] || '24h';
    if (!chartRenderer.PERIOD_PRESETS[actionParams.period]) {
      await ctx.reply(`Unknown chart period "${actionParams.period}".`);
      return;
    }
  } else if (actionType === 'broadcast') {
    actionParams.message = parts.slice(3).join(' ');
    if (!actionParams.message) {
      await ctx.reply('Broadcast rules need a message after the channel name.');
      return;
    }
  }

  const id = await rulesDb.add({
    triggerType,
    triggerSymbol: triggerSymbol ? triggerSymbol.toUpperCase() : null,
    actionType,
    actionParams,
  });
  await ctx.reply(`Rule #${id} created.`);
}
async function ruleDel(ctx, id) {
  await rulesDb.remove(Number(id));
  await ctx.answerCbQuery('Removed');
  await rulesScreen(ctx);
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
// Whoami / digest-now
// ---------------------------------------------------------------------------
async function whoami(ctx) {
  await ctx.reply(
    `You are ${config.adminName} (Telegram ID ${config.adminId}).\n` +
      `Chat ID: ${ctx.chat.id}\n` +
      `Bot: ${config.botName} v${require('../../package.json').version}`
  );
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
    await inlineReply(ctx, menu.testPicker());
    return;
  }
  await sendTestAlert(ctx, symbol);
}

// Simple immediate test (used by /test SYMBOL directly, and the old
// action:test: callback for backward compatibility) — a plain +1.2% up
// move sent to the default channel.
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
  await inlineEdit(ctx, menu.testDestinationPicker(symbol, type, valueCode, channels));
}

async function testExecute(ctx, symbol, type, valueCode, dest) {
  await ctx.answerCbQuery('Running test...');
  const coin = findCoin(symbol);
  if (!coin) {
    await ctx.reply(`Unknown symbol: ${symbol}`);
    return;
  }

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
      if (!coin.milestoneStep) {
        await ctx.reply(`${symbol} has no milestone step configured — nothing to simulate.`);
        return;
      }
      const level = pct >= 0
        ? (Math.floor(realPrice / coin.milestoneStep) + 1) * coin.milestoneStep
        : (Math.floor(realPrice / coin.milestoneStep) - 1) * coin.milestoneStep;
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

// "Run full pipeline check" — fires one of each alert type as a preview to
// the admin only, reporting pass/fail per step so a broken template/render
// path is caught in one tap rather than discovered live.
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
    if (!coin.milestoneStep) return true; // nothing to test for this coin, not a failure
    const level = (Math.floor(realPrice / coin.milestoneStep) + 1) * coin.milestoneStep;
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

// Failure injection — exercises the REAL failure-handling code paths
// (not a simulation narrated in text) so the admin-notification behavior
// can be verified without waiting for an actual outage.
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

// ---------------------------------------------------------------------------
// Guided text-input dispatcher — see services/pendingInput.js
// ---------------------------------------------------------------------------
async function handleGuidedInput(ctx, pending) {
  const text = ctx.message.text.trim();
  const parts = text.split(/\s+/);

  if (pending.action === 'addcoin') return runAddCoin(ctx, parts);
  if (pending.action === 'addchannel') return runAddChannel(ctx, parts);
  if (pending.action === 'addvar') return runSetVar(ctx, parts[0], parts.slice(1).join(' '));
  if (pending.action === 'addschedule') return runAddSchedule(ctx, parts);
  if (pending.action === 'addrule') return runAddRule(ctx, text);
  if (pending.action === 'setcaption') return runSetCaption(ctx, pending.context.alertType, text);
  if (pending.action === 'broadcast') return runBroadcast(ctx, pending.context.channelName, text);

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
  thresholdsCmd,
  thresholdEditScreen,
  thresholdAdjust,
  setThreshold,
  undoThreshold,
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
  historyCmd,
  channelsScreen,
  channelsListCmd,
  channelAddStart,
  addChannelCmd,
  removeChannelCmd,
  channelDel,
  setDefaultChannelCmd,
  channelSetDefault,
  captionTypesScreen,
  captionDetailScreen,
  captionEditStart,
  captionReset,
  captionPreview,
  setCaptionCmd,
  previewCaptionCmd,
  resetCaptionCmd,
  variablesCmd,
  variablesScreen,
  setVarCmd,
  delVarCmd,
  automationHubScreen,
  schedulesScreen,
  schedulesListCmd,
  scheduleAddStart,
  scheduleCmd,
  scheduleDel,
  rulesScreen,
  rulesListCmd,
  ruleAddStart,
  ruleCmd,
  ruleDel,
  broadcastCmd,
  whoami,
  digestNowCmd,
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
