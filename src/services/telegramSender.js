const config = require('../config');
const logger = require('../utils/logger');
const cardRenderer = require('./cardRenderer');
const format = require('../utils/format');
const { Input } = require('telegraf');

// Telegram caption uses HTML parse mode (see sendPhoto call below), so
// anything interpolated from coin data must be HTML-escaped here — this is
// separate from cardRenderer's escapeXml, which escapes for the SVG instead.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Two-line caption: "<b>Name</b> (SYMBOL) — $price ▲pct%" on the first line,
// the @PricePing watermark on its own line underneath. Stablecoins drop the
// arrow/percent badge since they don't get one on the card either.
function buildCaption({ coin, price, changePct, direction }) {
  const priceStr = `$${format.formatPrice(price)}`;
  const name = escapeHtml(coin.name);
  const symbol = escapeHtml(coin.symbol);

  let firstLine = `<b>${name}</b> (${symbol}) \u2014 ${priceStr}`;
  if (!coin.isStable && direction) {
    const arrow = format.directionSymbol(direction);
    firstLine += ` ${arrow} ${format.formatPct(changePct)}`;
  }

  return `${firstLine}\n@PricePing`;
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
        parse_mode: 'HTML',
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
