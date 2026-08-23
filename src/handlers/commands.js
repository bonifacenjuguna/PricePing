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
const marketData = require('../services/marketData');
const telegramSender = require('../services/telegramSender');
const chartRenderer = require('../services/chartRenderer');
const coinRegistry = require('../services/coinRegistry');
const format = require('../utils/format');
const { parseDuration, formatRemaining } = require('../utils/duration');
const logger = require('../utils/logger');

// In-memory "undo last threshold change" — single-admin bot, single
// process, so a module-level map is enough; doesn't need to survive a
// restart the way real state does.
const lastThresholdChange = new Map(); // symbol -> { value, type }

function inlineReply(ctx, screen) {
  return ctx.reply(screen.text, { reply_markup: { inline_keyboard: screen.keyboard } });
}

async function start(ctx) {
  await ctx.reply(
    `Welcome to PricePing admin \u2014 use the buttons below to navigate.`,
    bbtbMarkup
  );
  await home(ctx);
}

async function help(ctx) {
  await ctx.reply(
    `Commands:\n` +
      `/status \u2014 bot status, uptime, heartbeat\n` +
      `/prices \u2014 current price for all coins\n` +
      `/thresholds \u2014 view all alert thresholds\n` +
      `/setthreshold SYMBOL AMOUNT [pct] \u2014 change a threshold\n` +
      `/pause [DURATION] \u2014 stop posting (e.g. /pause 2h)\n` +
      `/resume \u2014 resume posting\n` +
      `/mute SYMBOL [DURATION] \u2014 silence one coin\n` +
      `/unmute SYMBOL \u2014 unsilence one coin\n` +
      `/post SYMBOL \u2014 post a price update to the channel now\n` +
      `/chart SYMBOL [1h|24h|7d|30d] \u2014 send yourself a price chart\n` +
      `/postchart SYMBOL [1h|24h|7d|30d] \u2014 post a chart to the channel\n` +
      `/addcoin SYMBOL PAIR COLOR [NAME] \u2014 track a new coin\n` +
      `/history SYMBOL \u2014 recent alerts for one coin\n` +
      `/stats \u2014 alert stats\n` +
      `/setsecondary CHANNEL_ID / /clearsecondary \u2014 mirror posts to a 2nd channel\n` +
      `/test [SYMBOL] \u2014 send a sample alert card\n` +
      `/whoami \u2014 confirm admin identity\n\n` +
      `Or use the menu buttons below.`
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
  const screen = menu.home({
    paused,
    pausedUntil,
    uptimeSeconds: process.uptime(),
    alertsToday,
    lastEvent: lastEvent || null,
    heartbeat,
  });
  await inlineReply(ctx, screen);
}

async function pricesCmd(ctx) {
  let map = {};
  try {
    const prices = await marketData.fetchAllPrices();
    map = Object.fromEntries(prices);
  } catch (err) {
    logger.warn('Failed to fetch prices for /prices command', { message: err.message });
    await ctx.reply('Could not reach Binance right now \u2014 try again shortly.');
    return;
  }
  const screen = menu.prices(map);
  await inlineReply(ctx, screen);
}

async function thresholdsCmd(ctx) {
  const map = await thresholdsDb.getAll();
  const screen = menu.thresholds(map);
  await inlineReply(ctx, screen);
}

async function statsCmd(ctx) {
  const [today, allTime, perCoin] = await Promise.all([
    alertsLogDb.countToday(),
    alertsLogDb.countAllTime(),
    alertsLogDb.countPerCoin(),
  ]);
  const screen = menu.stats({ today, allTime, perCoin });
  await inlineReply(ctx, screen);
}

async function settingsCmd(ctx) {
  const secondaryChannelId = await settingsDb.getSecondaryChannelId();
  const screen = menu.settings({ secondaryChannelId });
  await inlineReply(ctx, screen);
}

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
  const amount = Number(amountRaw);
  return { symbol, amount, type };
}

async function setThreshold(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const { symbol, amount, type } = parseThresholdArgs(parts);

  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(
      `Usage: /setthreshold SYMBOL AMOUNT [pct]\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`
    );
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
  const keyboard = previous
    ? [[{ text: '\u21A9 Undo', callback_data: `action:undothreshold:${symbol}` }]]
    : [];
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

async function pause(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const durationMs = parseDuration(parts[1]);
  if (durationMs) {
    const wake = new Date(Date.now() + durationMs);
    await settingsDb.setPausedUntil(wake);
    await ctx.reply(`Paused for ${formatRemaining(durationMs)} \u2014 will auto-resume, or /resume any time sooner.`);
    return;
  }
  await settingsDb.setPaused(true);
  await ctx.reply('Paused \u2014 no alerts will be posted until you /resume.');
}

async function resume(ctx) {
  await settingsDb.setPaused(false);
  await ctx.reply('Resumed \u2014 alerts will post as usual.');
}

async function mute(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(`Usage: /mute SYMBOL [DURATION]\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`);
    return;
  }
  const durationMs = parseDuration(parts[2]) || config.defaultMuteMs;
  const wake = new Date(Date.now() + durationMs);
  await coinStateDb.setMuteUntil(symbol, wake);
  await ctx.reply(`${symbol} muted for ${formatRemaining(durationMs)}. /unmute ${symbol} to lift it early.`);
}

async function unmute(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(`Usage: /unmute SYMBOL`);
    return;
  }
  await coinStateDb.clearMute(symbol);
  await ctx.reply(`${symbol} unmuted.`);
}

async function testAlert(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();

  if (!symbol) {
    const screen = menu.testPicker();
    await inlineReply(ctx, screen);
    return;
  }
  await sendTestAlert(ctx, symbol);
}

async function sendTestAlert(ctx, symbol) {
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(`Unknown symbol: ${symbol}`);
    return;
  }

  let price;
  try {
    const prices = await marketData.fetchAllPrices();
    price = prices.get(symbol);
  } catch (err) {
    logger.warn('Failed to fetch price for test alert', { message: err.message });
  }
  if (price === undefined) price = 100; // offline-safe fallback so /test always works

  const alert = {
    coin,
    price,
    changeUsd: coin.isStable ? 0 : 12.5,
    changePct: coin.isStable ? 0 : 1.2,
    direction: 'up',
  };

  const sent = await telegramSender.sendAlert(ctx.telegram, alert);
  await ctx.reply(sent ? `Test alert sent to the channel for ${symbol}.` : `Could not send test alert for ${symbol}.`);
}

// --- Manual price post: bare symbol in chat, or /post SYMBOL ---
async function manualPost(ctx, symbol) {
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(`Unknown symbol: ${symbol}`);
    return;
  }

  let price;
  let stats24h = null;
  let candles = [];
  try {
    const prices = await marketData.fetchAllPrices();
    price = prices.get(symbol);
    if (!coin.isStable) {
      [stats24h, candles] = await Promise.all([
        marketData.fetch24hrForSymbol(symbol).catch(() => null),
        marketData.fetchKlinesForSymbol(symbol, '15m', 96).catch(() => []),
      ]);
    }
  } catch (err) {
    logger.warn('Failed to fetch data for manual post', { message: err.message });
  }

  if (price === undefined) {
    await ctx.reply(`Could not reach Binance right now \u2014 try again shortly.`);
    return;
  }

  const sent = await telegramSender.sendManualPost(ctx.telegram, { coin, price, stats24h, candles });
  if (sent) {
    // Resets the threshold baseline too, so a routine follow-up threshold
    // alert doesn't fire moments later for the same already-announced move.
    await coinStateDb.recordAlert(symbol, price);
    await alertsLogDb.record(symbol, price, 0, 'up', 'manual');
    await ctx.reply(`Posted ${symbol} to the channel.`);
  } else {
    await ctx.reply(`Could not post ${symbol} \u2014 try again shortly.`);
  }
}

async function postCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  if (!symbol) {
    await ctx.reply('Usage: /post SYMBOL (e.g. /post BTC) \u2014 or just type a symbol on its own.');
    return;
  }
  await manualPost(ctx, symbol);
}

// --- Charts ---
function parseChartArgs(parts) {
  const symbol = (parts[1] || '').toUpperCase();
  const periodKey = (parts[2] || '24h').toLowerCase();
  return { symbol, periodKey };
}

async function chartCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const { symbol, periodKey } = parseChartArgs(parts);
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(`Usage: /chart SYMBOL [1h|24h|7d|30d]\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`);
    return;
  }
  const preset = chartRenderer.PERIOD_PRESETS[periodKey];
  if (!preset) {
    await ctx.reply(`Unknown period "${periodKey}". Choose one of: ${Object.keys(chartRenderer.PERIOD_PRESETS).join(', ')}`);
    return;
  }

  let candles;
  try {
    candles = await marketData.fetchKlinesForSymbol(symbol, preset.interval, preset.limit);
  } catch (err) {
    logger.warn('Failed to fetch klines for /chart', { message: err.message });
    await ctx.reply('Could not reach Binance right now \u2014 try again shortly.');
    return;
  }
  if (candles.length < 2) {
    await ctx.reply(`Not enough data to chart ${symbol} right now.`);
    return;
  }

  const buffer = await chartRenderer.renderChart({ coin, candles, periodKey });
  await ctx.replyWithPhoto(Input.fromBuffer(buffer, `${symbol}-${periodKey}.png`), {
    caption: `${coin.name} (${coin.symbol}) \u2014 ${preset.label}`,
  });
}

async function postChartCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const { symbol, periodKey } = parseChartArgs(parts);
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(`Usage: /postchart SYMBOL [1h|24h|7d|30d]\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`);
    return;
  }
  const preset = chartRenderer.PERIOD_PRESETS[periodKey];
  if (!preset) {
    await ctx.reply(`Unknown period "${periodKey}". Choose one of: ${Object.keys(chartRenderer.PERIOD_PRESETS).join(', ')}`);
    return;
  }

  let candles;
  try {
    candles = await marketData.fetchKlinesForSymbol(symbol, preset.interval, preset.limit);
  } catch (err) {
    await ctx.reply('Could not reach Binance right now \u2014 try again shortly.');
    return;
  }
  if (candles.length < 2) {
    await ctx.reply(`Not enough data to chart ${symbol} right now.`);
    return;
  }

  const buffer = await chartRenderer.renderChart({ coin, candles, periodKey });
  const caption = `<b>${coin.name}</b> (${coin.symbol}) \u2014 ${preset.label}\n@PricePing`;
  const sent = await telegramSender.sendPhotoWithRetry(
    ctx.telegram,
    config.channelId,
    buffer,
    `${symbol}-${periodKey}.png`,
    caption
  );
  await ctx.reply(sent ? `Chart posted to the channel for ${symbol}.` : `Could not post chart for ${symbol}.`);
}

// --- Runtime coin add ---
async function addCoinCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const pair = (parts[2] || '').toUpperCase();
  const color = parts[3] || '';
  const name = parts.slice(4).join(' ') || symbol;

  if (!symbol || !pair || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    await ctx.reply(
      'Usage: /addcoin SYMBOL BINANCEPAIR #HEXCOLOR [Name]\n' +
        'Example: /addcoin ADA ADAUSDT #0033AD Cardano'
    );
    return;
  }

  try {
    const { logoSource } = await coinRegistry.addCoin({ symbol, name, binancePair: pair, color });
    await ctx.reply(
      `${symbol} added \u2014 tracking ${pair}, default threshold set. ` +
        `Logo ${logoSource === 'downloaded' ? 'downloaded' : 'using a plain fallback (re-run later if you want the real logo)'}.`
    );
  } catch (err) {
    await ctx.reply(`Could not add ${symbol}: ${err.message}`);
  }
}

// --- History ---
async function historyCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(`Usage: /history SYMBOL`);
    return;
  }
  const rows = await alertsLogDb.recentForSymbol(symbol, 10);
  if (!rows.length) {
    await ctx.reply(`No alerts logged yet for ${symbol}.`);
    return;
  }
  const lines = rows.map((r) => {
    const arrow = r.direction === 'up' ? '\u25B2' : '\u25BC';
    return `${format.timeAgo(r.created_at)}  ${arrow} $${format.formatPrice(Number(r.price))}  [${r.alert_type}]`;
  });
  await ctx.reply(`Recent ${symbol} activity\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines.join('\n')}`);
}

// --- Secondary channel ---
async function setSecondaryCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const channelId = parts[1];
  if (!channelId) {
    await ctx.reply('Usage: /setsecondary CHANNEL_ID (e.g. @MyOtherChannel or -100xxxxxxxxxx)');
    return;
  }
  await settingsDb.setSecondaryChannelId(channelId);
  await ctx.reply(`Secondary channel set to ${channelId}. Every post will now also mirror there.`);
}

async function clearSecondaryCmd(ctx) {
  await settingsDb.setSecondaryChannelId(null);
  await ctx.reply('Secondary channel cleared.');
}

// --- Whoami / sanity check ---
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
    const marketDataMod = require('../services/marketData');
    const [priceMap, statsMap] = await Promise.all([
      marketDataMod.fetchAllPrices(),
      marketDataMod.fetchAll24hrStats(),
    ]);
    const message = digest.buildDigestMessage(priceMap, statsMap);
    await ctx.telegram.sendMessage(config.channelId, message, { parse_mode: 'HTML' });
    await ctx.reply('Digest posted.');
  } catch (err) {
    await ctx.reply(`Could not send digest: ${err.message}`);
  }
}

module.exports = {
  start,
  help,
  home,
  pricesCmd,
  thresholdsCmd,
  statsCmd,
  settingsCmd,
  setThreshold,
  undoThreshold,
  pause,
  resume,
  mute,
  unmute,
  testAlert,
  sendTestAlert,
  manualPost,
  postCmd,
  chartCmd,
  postChartCmd,
  addCoinCmd,
  historyCmd,
  setSecondaryCmd,
  clearSecondaryCmd,
  whoami,
  digestNowCmd,
};
