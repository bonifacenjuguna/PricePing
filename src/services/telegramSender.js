const config = require('../config');
const logger = require('../utils/logger');
const cardRenderer = require('./cardRenderer');
const format = require('../utils/format');
const { Input } = require('telegraf');

function buildCaption({ coin, price, changePct, direction }) {
  const priceStr = `$${format.formatPrice(price)}`;
  if (coin.isStable || !direction) {
    return `${coin.symbol} ${priceStr}`;
  }
  const arrow = format.directionSymbol(direction);
  return `${coin.symbol} ${priceStr} ${arrow}${format.formatPct(changePct)}`;
}

// telegram: a Telegraf `Telegram` API instance (either `bot.telegram` or
//   `ctx.telegram` — both expose the same sendPhoto/sendMessage methods).
// alert: { coin, price, changeUsd, changePct, direction }
// Renders the card and posts it to the channel. Retries once on a failed
// send (network blip, transient Telegram error), then gives up and logs —
// a single failed alert should never block the rest of the tick.
async function sendAlert(telegram, alert) {
  let buffer;
  try {
    buffer = await cardRenderer.renderCard(alert);
  } catch (err) {
    logger.error(`Failed to render card for ${alert.coin.symbol}`, { message: err.message });
    return false;
  }

  const caption = buildCaption(alert);
  const attempts = 1 + config.telegramSendRetries;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await telegram.sendPhoto(config.channelId, Input.fromBuffer(buffer, `${alert.coin.symbol}.png`), {
        caption,
      });
      return true;
    } catch (err) {
      logger.warn(`Send attempt ${attempt}/${attempts} failed for ${alert.coin.symbol}`, {
        message: err.message,
      });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  logger.error(`Giving up on ${alert.coin.symbol} alert after ${attempts} attempts`);
  return false;
}

module.exports = { sendAlert, buildCaption };
