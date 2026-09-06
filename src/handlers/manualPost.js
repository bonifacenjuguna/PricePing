const renderScreen = require('../utils/renderScreen');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const coinsDb = require('../db/coins');
const channelsDb = require('../db/channels');
const pendingInput = require('../services/pendingInput');
const cardRenderer = require('../services/cardRenderer');
const chartRenderer = require('../services/chartRenderer');
const telegramSender = require('../services/telegramSender');
const templateEngine = require('../services/templateEngine');
const { fetchWithMirrors } = require('../services/binanceClient');

const PAGE_SIZE = 8;

const PERIOD_TO_KLINES = {
  '1h': { interval: '1m', limit: 60 },
  '24h': { interval: '15m', limit: 96 },
  '7d': { interval: '1h', limit: 168 },
  '30d': { interval: '4h', limit: 180 },
};
const PERIOD_LABELS = { '1h': 'Last 1 hour', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };

async function showCoinList(ctx, page = 1) {
  const all = await coinsDb.getAll();
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const slice = all.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);
  await renderScreen(ctx, `📈 <b>Manual Post</b>\n\nPick a coin — page ${clampedPage}/${totalPages}`, {
    parse_mode: 'HTML',
    ...inline.manualPostCoinList(slice, clampedPage, totalPages),
  });
}

async function promptSearch(ctx) {
  await pendingInput.set('post:search');
  await ctx.reply('Send the coin symbol to post (e.g. "BTC").', bbtb.cancelOnly);
  await ctx.answerCbQuery();
}

async function showTypeChoice(ctx, symbol) {
  const coin = await coinsDb.get(symbol);
  if (!coin) return ctx.answerCbQuery('Coin not tracked.');
  await renderScreen(ctx, `<b>${symbol}</b> — post as what?`, { parse_mode: 'HTML', ...inline.manualPostTypeChoice(symbol) });
}

async function showChartStyle(ctx, symbol) {
  await renderScreen(ctx, `<b>${symbol}</b> chart style?`, { parse_mode: 'HTML', ...inline.manualPostChartStyle(symbol) });
}

async function showChartPeriod(ctx, chartStyle, symbol) {
  await renderScreen(ctx, `<b>${symbol}</b> — time period?`, {
    parse_mode: 'HTML',
    ...inline.manualPostChartPeriod(symbol, chartStyle),
  });
}

async function showChannelChoiceForCard(ctx, symbol) {
  const channels = await channelsDb.getAll();
  await renderScreen(ctx, `Send <b>${symbol}</b> price card to which channel?`, {
    parse_mode: 'HTML',
    ...inline.manualPostChannelChoice(`card:${symbol}`, channels),
  });
}

async function showChannelChoiceForChart(ctx, chartStyle, period, symbol) {
  const channels = await channelsDb.getAll();
  await renderScreen(ctx, `Send <b>${symbol}</b> ${chartStyle} chart (${PERIOD_LABELS[period]}) to which channel?`, {
    parse_mode: 'HTML',
    ...inline.manualPostChannelChoice(`chart:${chartStyle}:${period}:${symbol}`, channels),
  });
}

async function executeSend(ctx, kindKey, channelName) {
  await ctx.answerCbQuery('Sending…');
  const parts = kindKey.split(':');
  const kind = parts[0];

  try {
    let photo;
    let alertType;
    let ctxVars;

    if (kind === 'card') {
      const symbol = parts[1];
      const coin = await coinsDb.get(symbol);
      if (!coin) throw new Error('Coin not tracked.');
      photo = await cardRenderer.renderCard({
        coin: { symbol: coin.symbol, name: coin.name, color: coin.color, isStable: coin.is_stable },
        price: Number(coin.last_price),
        changeUsd: 0,
        changePct: 0,
        direction: 'up',
        alertType: 'manual',
      });
      alertType = 'manual';
      ctxVars = { coin: { symbol: coin.symbol, name: coin.name }, price: Number(coin.last_price) };
    } else {
      const [, chartStyle, period, symbol] = parts;
      const coin = await coinsDb.get(symbol);
      if (!coin) throw new Error('Coin not tracked.');
      const { interval, limit } = PERIOD_TO_KLINES[period];
      const raw = await fetchWithMirrors(`/api/v3/klines?symbol=${coin.binance_pair}&interval=${interval}&limit=${limit}`);
      const candles = raw.map((k) => ({ openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) }));
      photo = await chartRenderer.renderChart({
        coin: { symbol: coin.symbol, name: coin.name, color: coin.color },
        candles,
        periodKey: period,
        style: chartStyle,
      });
      alertType = 'chart';
      ctxVars = { coin: { symbol: coin.symbol, name: coin.name }, price: candles[candles.length - 1].close, periodLabel: PERIOD_LABELS[period] };
    }

    const targetChannels = channelName === '__all__' ? await channelsDb.getAll() : [await channelsDb.get(channelName)];

    for (const channelRow of targetChannels) {
      const channel = telegramSender.normalizeChannel(channelRow);
      const caption = await templateEngine.renderCaption(alertType, { ...ctxVars, channel });
      // eslint-disable-next-line no-await-in-loop
      await ctx.telegram.sendPhoto(channel.chatId, { source: photo }, { caption, parse_mode: 'HTML' });
    }

    await ctx.reply('✅ Sent.');
  } catch (err) {
    await ctx.reply(`⚠️ Failed to send: ${err.message}`);
  }
}

module.exports = {
  showCoinList,
  promptSearch,
  showTypeChoice,
  showChartStyle,
  showChartPeriod,
  showChannelChoiceForCard,
  showChannelChoiceForChart,
  executeSend,
};
