const { Markup } = require('telegraf');
const style = require('./buttonStyle');

/**
 * BBTB = "Buttons Below the Typing Bar" (Telegram reply keyboards).
 * Rule: BBTB carries frequent/reusable/low-risk shortcuts, shaped to
 * wherever you currently are — never a button whose destination is the
 * screen you're already on. Inline keyboards carry content + anything
 * destructive/confirm. Cancel/Skip only exist mid-flow and swap away the
 * moment they're not actionable.
 */
const b = (label) => style.text(label, style.BLUE);
const g = (label) => style.text(label, style.GREEN);

// Main menu — no "Menu" button here, you're already at it.
const mainMenu = Markup.keyboard([
  [b('⚡ Mode'), b('📈 Post'), b('📊 Status')],
]).resize();

// Every other screen adds "⬆️ Back to Menu" in front of the same three,
// since from there it's actually useful.
const withMenuShortcut = (...rows) => Markup.keyboard([[b('⬆️ Back to Menu')], ...rows]).resize();

const watching = withMenuShortcut([b('⚡ Mode'), b('📈 Post'), b('📊 Status')]);
const broadcasting = withMenuShortcut([b('⚡ Mode'), b('📈 Post'), b('📊 Status')]);
const automation = withMenuShortcut([b('⚡ Mode'), b('📈 Post'), b('📊 Status')]);
const botSettings = withMenuShortcut([b('⚡ Mode'), b('📈 Post'), b('📊 Status')]);

// Mid free-text input — only Cancel, nothing else, appears only while a
// reply is actually expected.
const cancelOnly = Markup.keyboard([[g('❌ Cancel')]]).resize();

const remove = Markup.removeKeyboard();

module.exports = {
  mainMenu,
  watching,
  broadcasting,
  automation,
  botSettings,
  cancelOnly,
  remove,
};
