const { Markup } = require('telegraf');
const { bySymbol } = require('../coins');
const marketData = require('../services/marketData');
const chartRenderer = require('../services/chartRenderer');
const templateEngine = require('../lib/templateEngine');
const { callback, navRow } = require('../keyboards/buttonStyle');
const { safeEdit } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');
const logger = require('../lib/logger');

// Step 1: pick a coin (reuses the same paginate() component as coinList.js)
async function showChartMenu(ctx, { page = 0 } = {}) {
  navStack.push(ctx, 'chartMenu', { page });
  const { paginate } = require('../keyboards/pagination');
  const { coins } = require('../coins');
  const { pageItems, controlRow } = paginate(coins, page, 8, 'chartlist');
  const rows = pageItems.map((c) => [callback(`${c.symbol} — ${c.name}`, `chart:pickcoin:${c.symbol}`)]);
  rows.push(...controlRow);
  rows.push(navRow());
  await safeEdit(ctx, '📈 *Charts*\n\nPick a coin.', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function showChartOptions(ctx, symbol) {
  navStack.push(ctx, 'chartOptions', { symbol });
  const coin = bySymbol.get(symbol);
  const rows = [
    [callback('1h', `chart:render:${symbol}:1h:line`), callback('24h', `chart:render:${symbol}:24h:line`)],
    [callback('7d', `chart:render:${symbol}:7d:line`), callback('30d', `chart:render:${symbol}:30d:line`)],
    [callback('🕯️ Candles instead', `chart:style:${symbol}:candle`)],
    navRow(),
  ];
  await safeEdit(ctx, `📈 *${coin.name}* — pick a period:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function showCandlePeriods(ctx, symbol) {
  const coin = bySymbol.get(symbol);
  const rows = [
    [callback('1h', `chart:render:${symbol}:1h:candle`), callback('24h', `chart:render:${symbol}:24h:candle`)],
    [callback('7d', `chart:render:${symbol}:7d:candle`), callback('30d', `chart:render:${symbol}:30d:candle`)],
    [callback('📈 Line instead', `chart:style:${symbol}:line`)],
    navRow(),
  ];
  await safeEdit(ctx, `🕯️ *${coin.name}* — pick a period:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

async function renderAndSend(ctx, symbol, periodKey, style) {
  const coin = bySymbol.get(symbol);
  const preset = chartRenderer.PERIOD_PRESETS[periodKey];
  try {
    await ctx.answerCbQuery('Rendering chart…');
    const { candles, source } = await marketData.fetchCandles(symbol, {
      interval: preset.binanceInterval,
      limit: preset.limit,
      krakenIntervalMinutes: preset.krakenMinutes,
      geckoDays: preset.geckoDays,
    });
    const buffer = await chartRenderer.renderChart({ coin, candles, periodKey, style, source });
    const lastPrice = candles.length ? candles[candles.length - 1].close : 0;
    const caption = await templateEngine.renderCaption('chart', { coin, price: lastPrice, periodLabel: `${preset.label} (${style})` });
    await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: 'HTML' });
  } catch (err) {
    logger.error('Chart render failed', { symbol, periodKey, style, message: err.message });
    await ctx.reply(`⚠️ Couldn't render that chart right now (${symbol} data unavailable). Try again shortly.`);
  }
}

module.exports = { showChartMenu, showChartOptions, showCandlePeriods, renderAndSend };
