const { Input } = require('telegraf');
const config = require('../config');
const logger = require('../utils/logger');
const cardRenderer = require('./cardRenderer');
const templateEngine = require('./templateEngine');

// Generic retrying photo send — shared by every send path (threshold
// alerts, manual posts, milestone alerts, charts, rule-driven mirrors). A
// single failed send never blocks the rest of a tick or command.
// Telegram's 429 responses include how long to actually wait
// (err.response.parameters.retry_after, in seconds) — using that instead
// of a blind fixed delay is the difference between "backs off correctly"
// and "hammers the API again right when it just said not to."
function backoffDelayMs(err, attempt) {
  const retryAfterSec = err && err.response && err.response.parameters && err.response.parameters.retry_after;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return retryAfterSec * 1000 + 250; // small buffer past what Telegram asked for
  }
  return 2000 * attempt; // fixed-delay fallback for non-429 failures
}

async function sendPhotoWithRetry(telegram, chatId, buffer, filename, caption) {
  const attempts = 1 + config.telegramSendRetries;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await telegram.sendPhoto(chatId, Input.fromBuffer(buffer, filename), {
        caption,
        parse_mode: 'HTML',
      });
      return true;
    } catch (err) {
      logger.warn(`Send attempt ${attempt}/${attempts} failed for ${filename}`, { message: err.message });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(err, attempt)));
      }
    }
  }
  logger.error(`Giving up on ${filename} after ${attempts} attempts`);
  return false;
}

async function sendMessageWithRetry(telegram, chatId, text) {
  const attempts = 1 + config.telegramSendRetries;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
      return true;
    } catch (err) {
      logger.warn(`Message send attempt ${attempt}/${attempts} failed`, { message: err.message });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(err, attempt)));
      }
    }
  }
  return false;
}

// alert: { coin, price, changeUsd, changePct, direction, alertType,
//          milestoneLevel, threshold, cooldownRemainingMs }
// channel: { name, chatId } — REQUIRED. Automatic alerts resolve this to
// the default channel in poller.js; manual commands resolve it from an
// optional trailing arg. There is no more implicit "send everywhere."
async function sendAlert(telegram, alert, channel) {
  if (!channel) {
    logger.error(`sendAlert called with no channel for ${alert.coin.symbol} — dropping`);
    return false;
  }

  let buffer;
  try {
    buffer = await cardRenderer.renderCard(alert);
  } catch (err) {
    logger.error(`Failed to render card for ${alert.coin.symbol}`, { message: err.message });
    return false;
  }

  const caption = await templateEngine.renderCaption(alert.alertType || 'threshold', { ...alert, channel });
  return sendPhotoWithRetry(telegram, channel.chatId, buffer, `${alert.coin.symbol}.png`, caption);
}

// Manual /post SYMBOL — richer card. channel required, same as sendAlert.
async function sendManualPost(telegram, { coin, price, stats24h, candles, changeSinceLastPost, alertCountToday }, channel) {
  if (!channel) {
    logger.error(`sendManualPost called with no channel for ${coin.symbol} — dropping`);
    return false;
  }

  let buffer;
  try {
    buffer = await cardRenderer.renderRichCard({ coin, price, stats24h, candles });
  } catch (err) {
    logger.error(`Failed to render rich card for ${coin.symbol}`, { message: err.message });
    return false;
  }

  const direction = stats24h ? (stats24h.priceChangePercent >= 0 ? 'up' : 'down') : null;
  const caption = await templateEngine.renderCaption('manual', {
    coin,
    price,
    stats24h,
    direction,
    changePct: stats24h ? stats24h.priceChangePercent : null,
    changeSinceLastPost,
    alertCountToday,
    channel,
  });

  return sendPhotoWithRetry(telegram, channel.chatId, buffer, `${coin.symbol}.png`, caption);
}

// /chart and /postchart. channel required.
async function sendChart(telegram, { coin, buffer, periodLabel }, channel) {
  if (!channel) {
    logger.error(`sendChart called with no channel for ${coin.symbol} — dropping`);
    return false;
  }
  const caption = await templateEngine.renderCaption('chart', { coin, periodLabel, channel });
  return sendPhotoWithRetry(telegram, channel.chatId, buffer, `${coin.symbol}-chart.png`, caption);
}

// /broadcast — a plain custom text message to a named channel, no image.
async function sendBroadcast(telegram, message, channel) {
  if (!channel) return false;
  return sendMessageWithRetry(telegram, channel.chatId, message);
}

module.exports = {
  sendAlert,
  sendManualPost,
  sendChart,
  sendBroadcast,
  sendPhotoWithRetry,
  sendMessageWithRetry,
};
