const config = require('../config');
const logger = require('../utils/logger');
const format = require('../utils/format');
const marketData = require('./marketData');
const settingsDb = require('../db/settings');

let intervalHandle = null;

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

  const header = `\uD83D\uDCCA <b>Daily digest</b> \u2014 ${todayUtcDateStr()} UTC`;
  const bigMoverLine = biggestMover
    ? `\n\n\uD83D\uDD25 Big mover: <b>${biggestMover.symbol}</b> ${biggestMover.pct >= 0 ? '\u25B2' : '\u25BC'} ${format.formatPct(
        biggestMover.pct
      )} (24h)`
    : '';

  return `${header}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines.join(
    '\n'
  )}${bigMoverLine}\n\n@PricePing`;
}

async function sendDigestIfDue(bot) {
  if (!config.digestEnabled) return;

  const now = new Date();
  if (now.getUTCHours() !== config.digestHourUtc) return;

  const lastSent = await settingsDb.getLastDigestDate();
  const today = todayUtcDateStr();
  if (lastSent === today) return; // already sent today

  let priceMap;
  let statsMap;
  try {
    [priceMap, statsMap] = await Promise.all([marketData.fetchAllPrices(), marketData.fetchAll24hrStats()]);
  } catch (err) {
    logger.warn('Digest: failed to fetch market data, will retry next check', { message: err.message });
    return;
  }

  const message = buildDigestMessage(priceMap, statsMap);

  try {
    await bot.telegram.sendMessage(config.channelId, message, { parse_mode: 'HTML' });
    await settingsDb.setLastDigestDate(today);
    logger.info('Sent daily digest');
  } catch (err) {
    logger.error('Failed to send daily digest', { message: err.message });
  }
}

// Checked every 5 minutes rather than tied to the poll tick — keeps digest
// timing independent of POLL_INTERVAL_MS changes.
function init(bot) {
  intervalHandle = setInterval(() => {
    sendDigestIfDue(bot).catch((err) => logger.error('Digest check failed', { message: err.message }));
  }, 5 * 60 * 1000);
}

function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = { init, stop, buildDigestMessage, sendDigestIfDue };
