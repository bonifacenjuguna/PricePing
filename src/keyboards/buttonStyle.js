/**
 * Bot API 9.4+ button `style` field: 'danger' (red), 'success' (green),
 * 'primary' (blue). Attached directly onto Telegraf's Markup.button.*
 * output so it works regardless of installed Telegraf's TS types.
 *
 * Four-tier mapping, same rule locked in during design:
 *   RED   — ONLY the single button that executes something irreversible
 *           (Remove Channel, force-delist a coin). Smallest, rarest tier
 *           on purpose — that's what makes it alarming when it appears.
 *   GREEN — means exactly one thing: "the safe way out." Every real
 *           Cancel button, everywhere, no exceptions.
 *   BLUE  — "the expected way to move forward" — navigation AND the
 *           confirm side of already-safe actions.
 *   colorless — incidental: pagination, individual picks inside a flow,
 *           minor toggles. No style key — Telegram's normal default.
 */
const { Markup } = require('telegraf');

const RED = 'danger';
const GREEN = 'success';
const BLUE = 'primary';

const MAX_CALLBACK_DATA_BYTES = 64;
function checkCallbackLength(data) {
  const bytes = Buffer.byteLength(data, 'utf8');
  if (bytes > MAX_CALLBACK_DATA_BYTES) {
    const logger = require('../utils/logger');
    logger.warn('callback_data exceeds Telegram\u2019s 64-byte limit — this button will fail', {
      bytes,
      data: data.length > 80 ? `${data.slice(0, 80)}…` : data,
    });
  }
}

function callback(text, data, colorStyle) {
  checkCallbackLength(data);
  const button = Markup.button.callback(text, data);
  return colorStyle ? { ...button, style: colorStyle } : button;
}

function text(label, colorStyle) {
  const button = Markup.button.text(label);
  return colorStyle ? { ...button, style: colorStyle } : button;
}

function url(label, link, colorStyle) {
  const button = Markup.button.url(label, link);
  return colorStyle ? { ...button, style: colorStyle } : button;
}

module.exports = { RED, GREEN, BLUE, callback, text, url };
