const config = require('../config');
const logger = require('../utils/logger');
const format = require('../utils/format');
const marketData = require('./marketData');
const channelsDb = require('../db/channels');

// As of v0.4.0, digests are fired by automationScheduler.js reading the
// `schedules` table (kind='digest') — this lets a digest run on any
// cadence (hourly/daily/weekly), not just once a day, and show up
// alongside every other automation in /schedules. migrate.js seeds one
// default daily schedule from DIGEST_HOUR_UTC/DIGEST_ENABLED the first
// time it runs against a fresh install; after that, DIGEST_HOUR_UTC has
// no further effect — edit or add digest schedules via /schedule instead.
// This module now only builds the message and sends it — no more of its
// own interval loop.

function todayUtcDateStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function buildDigestMessage(priceMap, statsMap) {
  const lines = [];
  let biggestMover = null;

  for (const coin of config.coins) {
    const price = priceMap.get(coin.symbol);
    const stats = statsMap.get(coin.symbol);
    if (price === undefined) continue;

    const priceStr = `$${format.formatPrice(price)}`;
    let changeStr = '';
    if (!coin.isStable && stats) {
      const arrow = stats.priceChangePercent >= 0 ? '\u25B2' : '\u25BC';
      changeStr = ` ${arrow} ${format.formatPct(stats.priceChangePercent)}`;
      if (!biggestMover || Math.abs(stats.priceChangePercent) > Math.abs(biggestMover.pct)) {
        biggestMover = { symbol: coin.symbol, pct: stats.priceChangePercent };
      }
    }
    lines.push(`${coin.symbol.padEnd(5, ' ')} ${priceStr}${changeStr}`);
  }

  const header = `\uD83D\uDCCA <b>Digest</b> \u2014 ${todayUtcDateStr()} UTC`;
  const bigMoverLine = biggestMover
    ? `\n\n\uD83D\uDD25 Big mover: <b>${biggestMover.symbol}</b> ${biggestMover.pct >= 0 ? '\u25B2' : '\u25BC'} ${format.formatPct(
        biggestMover.pct
      )} (24h)`
    : '';

  return `${header}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines.join(
    '\n'
  )}${bigMoverLine}\n\n@PricePing`;
}

// Called by automationScheduler.js when a schedule with kind='digest' is
// due. channelName: which registered channel to post to.
async function sendDigestToChannel(telegram, channelName) {
  const channel = await channelsDb.resolve(channelName);
  if (!channel) {
    logger.warn(`Digest schedule: unknown channel "${channelName}"`);
    return false;
  }

  let priceMap;
  let statsMap;
  try {
    [priceMap, statsMap] = await Promise.all([marketData.fetchAllPrices(), marketData.fetchAll24hrStats()]);
  } catch (err) {
    logger.warn('Digest: failed to fetch market data', { message: err.message });
    return false;
  }

  const message = buildDigestMessage(priceMap, statsMap);
  try {
    await telegram.sendMessage(channel.chatId, message, { parse_mode: 'HTML' });
    return true;
  } catch (err) {
    logger.error('Failed to send digest', { message: err.message });
    return false;
  }
}

module.exports = { buildDigestMessage, sendDigestToChannel };
