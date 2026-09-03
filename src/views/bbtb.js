const BBTB_LABELS = {
  home: '\uD83C\uDFE0 Home', // 🏠
  prices: '\uD83D\uDCB0 Prices', // 💰
  thresholds: '\uD83C\uDFDA Thresholds', // 🎚
  stats: '\uD83D\uDCC8 Stats', // 📈
  markets: '\uD83D\uDC8E Markets', // 💎
  movers: '\uD83D\uDCC9 Movers', // 📉
  coins: '\uD83E\uDE99 Coins', // 🪙
  feargreed: '\uD83D\uDE28 Fear & Greed', // 😨
};

// Default layout — 2x3 now instead of 2x2, room for the two features that
// didn't exist when this was first built.
const bbtbDefault = {
  reply_markup: {
    keyboard: [
      [BBTB_LABELS.home, BBTB_LABELS.prices, BBTB_LABELS.markets],
      [BBTB_LABELS.thresholds, BBTB_LABELS.stats, BBTB_LABELS.movers],
    ],
    resize_keyboard: true,
    is_persistent: true,
  },
};

// Markets-focused layout — swapped in when the Markets button on the
// default keyboard is tapped (see text.js), swapped back on the next Home
// tap. This can only happen on a BBTB (ReplyKeyboardMarkup) tap, never an
// inline-button tap — Telegram's editMessageText can't attach a
// ReplyKeyboardMarkup, only an InlineKeyboardMarkup, so there's no way to
// change the persistent bottom keyboard from inline navigation. Deep
// inline navigation back to Home won't auto-reset this; the next BBTB
// Home tap will.
const bbtbMarkets = {
  reply_markup: {
    keyboard: [
      [BBTB_LABELS.home, BBTB_LABELS.markets, BBTB_LABELS.coins],
      [BBTB_LABELS.movers, BBTB_LABELS.feargreed, BBTB_LABELS.prices],
    ],
    resize_keyboard: true,
    is_persistent: true,
  },
};

// Backward-compat name — existing imports expect `bbtbMarkup` as "the"
// keyboard; it's now specifically the default one.
const bbtbMarkup = bbtbDefault;

module.exports = { BBTB_LABELS, bbtbMarkup, bbtbDefault, bbtbMarkets };
