const config = require('../config');
const menu = require('../views/menu');
const { bbtbMarkup } = require('../views/bbtb');
const thresholdsDb = require('../db/thresholds');
const coinStateDb = require('../db/coinState');
const alertsLogDb = require('../db/alertsLog');
const settingsDb = require('../db/settings');
const eventsDb = require('../db/events');
const marketData = require('../services/marketData');
const telegramSender = require('../services/telegramSender');
const poller = require('../services/poller');
const logger = require('../utils/logger');

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
      `/status \u2014 bot status and uptime\n` +
      `/prices \u2014 current prices for all coins\n` +
      `/thresholds \u2014 view all alert thresholds\n` +
      `/setthreshold SYMBOL AMOUNT \u2014 change a threshold\n` +
      `/pause \u2014 stop posting to the channel\n` +
      `/resume \u2014 resume posting\n` +
      `/test SYMBOL \u2014 send a sample alert card\n\n` +
      `Or use the menu buttons below.`
  );
}

async function home(ctx) {
  const [paused, alertsToday, [lastEvent]] = await Promise.all([
    settingsDb.isPaused(),
    alertsLogDb.countToday(),
    eventsDb.latest(1),
  ]);
  const screen = menu.home({
    paused,
    uptimeSeconds: process.uptime(),
    alertsToday,
    lastEvent: lastEvent || null,
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
  const screen = menu.settings();
  await inlineReply(ctx, screen);
}

async function setThreshold(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/);
  const symbol = (parts[1] || '').toUpperCase();
  const amount = Number(parts[2]);

  const coin = config.coins.find((c) => c.symbol === symbol);
  if (!coin) {
    await ctx.reply(
      `Usage: /setthreshold SYMBOL AMOUNT\nKnown symbols: ${config.coins.map((c) => c.symbol).join(', ')}`
    );
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply('Amount must be a positive number, e.g. /setthreshold BTC 400');
    return;
  }

  await thresholdsDb.set(symbol, amount);
  await ctx.reply(`Threshold for ${symbol} set to $${amount}.`);
}

async function pause(ctx) {
  await settingsDb.setPaused(true);
  await ctx.reply('Paused \u2014 no alerts will be posted until you /resume.');
}

async function resume(ctx) {
  await settingsDb.setPaused(false);
  await ctx.reply('Resumed \u2014 alerts will post as usual.');
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

module.exports = {
  start,
  help,
  home,
  pricesCmd,
  thresholdsCmd,
  statsCmd,
  settingsCmd,
  setThreshold,
  pause,
  resume,
  testAlert,
  sendTestAlert,
};
