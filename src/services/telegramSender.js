const config = require('../config');
const logger = require('../utils/logger');
const cardRenderer = require('./cardRenderer');
const format = require('../utils/format');
const settingsDb = require('../db/settings');
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

// Three-row caption:
//   <b>Name</b> (SYMBOL) — $price
//   ▲ pct%                          (own row — omitted for stablecoins)
//   @PricePing
//
// Milestone alerts have no changePct (they fire on a round-number crossing,
// not a threshold move — see poller.js's checkMilestone), so they get their
// own second-row wording instead of a percentage that doesn't exist.
function buildCaption({ coin, price, changePct, direction, alertType, milestoneLevel }) {
  const priceStr = `$${format.formatPrice(price)}`;
  const name = escapeHtml(coin.name);
  const symbol = escapeHtml(coin.symbol);

  const firstLine = `<b>${name}</b> (${symbol}) \u2014 ${priceStr}`;
  const rows = [firstLine];

  if (alertType === 'milestone') {
    const arrow = format.directionSymbol(direction);
    rows.push(`${arrow} Crossed $${format.formatPrice(milestoneLevel)}`);
  } else if (!coin.isStable && direction && changePct !== null && changePct !== undefined) {
    const arrow = format.directionSymbol(direction);
    rows.push(`${arrow} ${format.formatPct(changePct)}`);
  }
  rows.push('@PricePing');

  return rows.join('\n');
}

// Richer caption for manual /post — adds a 24h stat line ahead of the
// watermark. Distinct from buildCaption on purpose (see cardRenderer.js).
function buildRichCaption({ coin, price, stats24h }) {
  const priceStr = `$${format.formatPrice(price)}`;
  const name = escapeHtml(coin.name);
  const symbol = escapeHtml(coin.symbol);

  const rows = [`<b>${name}</b> (${symbol}) \u2014 ${priceStr}`];
  if (!coin.isStable && stats24h) {
    const direction = stats24h.priceChangePercent >= 0 ? 'up' : 'down';
    const arrow = format.directionSymbol(direction);
    rows.push(
      `24h ${arrow} ${format.formatPct(stats24h.priceChangePercent)}  \u00B7  ` +
        `H $${format.formatPrice(stats24h.highPrice)}  \u00B7  L $${format.formatPrice(stats24h.lowPrice)}`
    );
  }
  rows.push('@PricePing');
  return rows.join('\n');
}

// Generic retrying photo send — shared by threshold alerts, manual posts,
// milestone alerts, digests, and charts. A single failed send never blocks
// the rest of a tick or command.
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
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  logger.error(`Giving up on ${filename} after ${attempts} attempts`);
  return false;
}

// telegram: a Telegraf `Telegram` API instance (either `bot.telegram` or
//   `ctx.telegram` — both expose the same sendPhoto/sendMessage methods).
// alert: { coin, price, changeUsd, changePct, direction }
// Renders the card and posts it to the primary channel, and to the
// secondary channel too if one is configured (see /setsecondary).
async function sendAlert(telegram, alert) {
  let buffer;
  try {
    buffer = await cardRenderer.renderCard(alert);
  } catch (err) {
    logger.error(`Failed to render card for ${alert.coin.symbol}`, { message: err.message });
    return false;
  }

  const caption = buildCaption(alert);
  const sentPrimary = await sendPhotoWithRetry(
    telegram,
    config.channelId,
    buffer,
    `${alert.coin.symbol}.png`,
    caption
  );

  const secondaryChannelId = await settingsDb.getSecondaryChannelId();
  if (secondaryChannelId) {
    await sendPhotoWithRetry(telegram, secondaryChannelId, buffer, `${alert.coin.symbol}.png`, caption);
  }

  return sentPrimary;
}

// Manual /post SYMBOL — richer card, always posts to the primary channel
// (and secondary, if set). Returns true/false like sendAlert.
async function sendManualPost(telegram, { coin, price, stats24h, candles }) {
  let buffer;
  try {
    buffer = await cardRenderer.renderRichCard({ coin, price, stats24h, candles });
  } catch (err) {
    logger.error(`Failed to render rich card for ${coin.symbol}`, { message: err.message });
    return false;
  }

  const caption = buildRichCaption({ coin, price, stats24h });
  const sentPrimary = await sendPhotoWithRetry(telegram, config.channelId, buffer, `${coin.symbol}.png`, caption);

  const secondaryChannelId = await settingsDb.getSecondaryChannelId();
  if (secondaryChannelId) {
    await sendPhotoWithRetry(telegram, secondaryChannelId, buffer, `${coin.symbol}.png`, caption);
  }

  return sentPrimary;
}

module.exports = { sendAlert, sendManualPost, sendPhotoWithRetry, buildCaption, buildRichCaption, escapeHtml };
