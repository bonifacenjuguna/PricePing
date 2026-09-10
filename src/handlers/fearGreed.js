const { Markup } = require('telegraf');
const marketData = require('../services/marketData');
const { navRow } = require('../keyboards/buttonStyle');
const { safeEdit } = require('../lib/ephemeral');
const navStack = require('../lib/navStack');
const logger = require('../lib/logger');

const EMOJI_BY_CLASS = {
  'Extreme Fear': '😱',
  Fear: '😨',
  Neutral: '😐',
  Greed: '🤑',
  'Extreme Greed': '🚀',
};

function barFor(value) {
  const filled = Math.round(value / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

async function showFearGreed(ctx) {
  navStack.push(ctx, 'fearGreed', {});
  try {
    const { value, classification } = await marketData.fetchFearGreed();
    const emoji = EMOJI_BY_CLASS[classification] || '📊';
    const text =
      `😨 *Fear & Greed Index*\n\n` +
      `${emoji} *${value}/100* — ${classification}\n\n` +
      `${barFor(value)}\n\n` +
      `_Source: Alternative.me_`;
    await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([navRow()]) });
  } catch (err) {
    logger.warn('Fear & Greed fetch failed', { message: err.message });
    await safeEdit(ctx, '⚠️ Fear & Greed data is temporarily unavailable. Try again shortly.', Markup.inlineKeyboard([navRow()]));
  }
}

module.exports = { showFearGreed };
