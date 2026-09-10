const { Markup } = require('telegraf');

// Thin wrapper kept for consistency/readability at call sites — every
// inline button in the bot goes through this so the shape stays uniform.
function callback(text, data) {
  return Markup.button.callback(text, data);
}

function url(text, link) {
  return Markup.button.url(text, link);
}

// Every inline menu screen should end with these (see "no dead ends" rule)
// — Back returns to the previous screen via navStack, Home resets to root.
function navRow() {
  return [callback('⬅️ Back', 'nav:back'), callback('🏠 Home', 'nav:home')];
}

module.exports = { callback, url, navRow };
