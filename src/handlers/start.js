const usersDb = require('../db/users');
const replyKb = require('../keyboards/replyKeyboards');
const { callback } = require('../keyboards/buttonStyle');
const { Markup } = require('telegraf');
const navStack = require('../lib/navStack');

const BOT_NAME = 'CryptoPulse'; // placeholder — swap for the real bot name/branding

async function handleStart(ctx) {
  const existing = await usersDb.getOrCreate(ctx.from.id, ctx.from.username);
  navStack.reset(ctx);
  const isReturning = existing && existing.created_at && Date.now() - new Date(existing.created_at).getTime() > 60000;

  const text = isReturning
    ? `👋 Welcome back to *${BOT_NAME}*.`
    : `👋 *${BOT_NAME}*\n\nLive prices, charts, milestones and threshold alerts for 22 assets — right here in Telegram.\n\nUse the menu below to get started.`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...replyKb.home });
}

async function handleHelp(ctx) {
  const text =
    `ℹ️ *Help*\n\nTap a section below to jump straight in, or use the menu buttons any time.\n\n` +
    `Commands:\n/start — main menu\n/settings — settings & status\n/help — this screen`;
  const rows = [
    [callback('📊 Prices', 'help:goto:prices'), callback('📈 Charts', 'help:goto:charts')],
    [callback('🐋 Milestones', 'help:goto:milestones'), callback('😨 Fear & Greed', 'help:goto:feargreed')],
    [callback('⚙️ Settings', 'help:goto:settings')],
  ];
  await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

module.exports = { handleStart, handleHelp, BOT_NAME };
