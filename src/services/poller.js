const config = require('../config');
const logger = require('../utils/logger');
const coinsDb = require('../db/coins');
const modes = require('./modes');
const cardRenderer = require('./cardRenderer');
const telegramSender = require('./telegramSender');
const { fetchWithMirrors } = require('./binanceClient');
const priceFallback = require('./priceFallback');
const heartbeatDb = require('../db/heartbeat');

// Effective threshold for a coin right now = its tier/override base value,
// scaled by the current Bot Mode's multiplier. Nitro (0.25x) fires far more
// often than Anti-Spam (2x) off the exact same base number.
async function effectiveThreshold(coin) {
  const mode = await modes.getCurrentMode();
  return coin.threshold_value * mode.multiplier;
}

function pctChange(oldPrice, newPrice) {
  if (!Number.isFinite(oldPrice) || oldPrice === 0) return null;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}

async function checkCoin(coin, livePrice) {
  if (coin.muted || coin.is_stable) {
    await coinsDb.setLastPrice(coin.symbol, livePrice);
    return;
  }

  const lastAlertPrice = coin.last_alert_price !== null ? Number(coin.last_alert_price) : livePrice;
  const changePct = pctChange(lastAlertPrice, livePrice);
  const changeUsd = livePrice - lastAlertPrice;
  const threshold = await effectiveThreshold(coin);

  let fired = false;

  if (coin.threshold_type === 'pct' && changePct !== null && Math.abs(changePct) >= threshold) {
    fired = true;
  } else if (coin.threshold_type === 'usd' && Math.abs(changeUsd) >= threshold) {
    fired = true;
  }

  // Milestone check — crossing a round-number step, independent of the
  // threshold move above.
  let milestoneLevel = null;
  let isBigMilestone = false;
  if (coin.milestone_step) {
    const step = Number(coin.milestone_step);
    const prevMilestone = Math.floor(lastAlertPrice / step);
    const newMilestone = Math.floor(livePrice / step);
    if (newMilestone !== prevMilestone && newMilestone > 0) {
      milestoneLevel = newMilestone * step;
      isBigMilestone = newMilestone % 10 === 0;
    }
  }

  if (fired || milestoneLevel !== null) {
    const direction = livePrice >= lastAlertPrice ? 'up' : 'down';
    const coinForCard = {
      symbol: coin.symbol,
      name: coin.name,
      color: coin.color,
      isStable: coin.is_stable,
      milestoneStep: coin.milestone_step,
    };
    const alertType = milestoneLevel !== null ? 'milestone' : 'threshold';

    try {
      const photo = await cardRenderer.renderCard({
        coin: coinForCard,
        price: livePrice,
        changeUsd,
        changePct,
        direction,
        alertType,
        milestoneLevel,
        isBigMilestone,
      });

      await telegramSender.broadcast(
        alertType,
        {
          coin: coinForCard,
          price: livePrice,
          changeUsd,
          changePct,
          direction,
          alertType,
          milestoneLevel,
          threshold: { value: coin.threshold_value, type: coin.threshold_type },
        },
        photo
      );
    } catch (err) {
      logger.warn(`Failed to render/send alert for ${coin.symbol}`, { message: err.message });
    }

    await coinsDb.setLastAlertPrice(coin.symbol, livePrice);
  }

  await coinsDb.setLastPrice(coin.symbol, livePrice);
}

let binanceDown = false;

async function pollOnce() {
  const tickStart = Date.now();
  let priceByPair;
  let usingFallback = false;

  try {
    const tickers = await fetchWithMirrors('/api/v3/ticker/price');
    priceByPair = new Map(tickers.map((t) => [t.symbol, Number(t.price)]));
    if (binanceDown) {
      binanceDown = false;
      logger.info('Binance reachable again — resuming normal polling');
      telegramSender.notifyOwner('✅ Binance is back — full price polling resumed.').catch(() => {});
    }
  } catch (err) {
    logger.warn('Binance ticker/price fully unreachable, falling back to core coins only', { message: err.message });
    if (!binanceDown) {
      binanceDown = true;
      telegramSender.notifyOwner(
        `⚠️ Binance is unreachable across all mirrors. Falling back to CoinGecko/Kraken for your ${config.coreCoinSymbols.length} core coins only — everything else is paused until Binance recovers.`
      ).catch(() => {});
    }
    usingFallback = true;
    priceByPair = null;
  }

  const coins = await coinsDb.getAll();

  if (usingFallback) {
    const corePrices = await priceFallback.getCorePrices();
    for (const coin of coins) {
      if (!config.coreCoinSymbols.includes(coin.symbol)) continue; // eslint-disable-line no-continue
      const livePrice = corePrices[coin.symbol];
      if (livePrice === undefined) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await checkCoin(coin, livePrice);
    }
  } else {
    for (const coin of coins) {
      const livePrice = priceByPair.get(coin.binance_pair);
      if (livePrice === undefined) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await checkCoin(coin, livePrice);
    }
  }

  await heartbeatDb.touch(Date.now() - tickStart).catch((err) => logger.warn('Heartbeat touch failed', { message: err.message }));
}

let pollTimer = null;
function startPolling() {
  pollTimer = setInterval(() => {
    pollOnce().catch((err) => logger.warn('Price poll failed', { message: err.message }));
  }, config.pollIntervalMs);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
}

module.exports = { pollOnce, startPolling, stopPolling, effectiveThreshold };
