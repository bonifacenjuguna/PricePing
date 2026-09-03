const BBTB_LABELS = {
  home: '\uD83C\uDFE0 Home', // 🏠
  prices: '\uD83D\uDCB0 Prices', // 💰
  thresholds: '\uD83C\uDFDA Thresholds', // 🎚
  stats: '\uD83D\uDCC8 Stats', // 📈
};

const bbtbMarkup = {
  reply_markup: {
    keyboard: [
      [BBTB_LABELS.home, BBTB_LABELS.prices],
      [BBTB_LABELS.thresholds, BBTB_LABELS.stats],
    ],
    resize_keyboard: true,
    is_persistent: true,
  },
};

module.exports = { BBTB_LABELS, bbtbMarkup };
