const path = require('path');

// ---------------------------------------------------------------------------
// v1.0.0: the static coin list is gone. Coins are now discovered and kept in
// sync automatically from Binance's public exchangeInfo/ticker endpoints
// (see services/binanceSync.js) and persisted in the `coins` table (see
// db/coins.js) — no more manual /addcoin. This file now only exposes the
// asset directory paths, kept env-var-free so it stays safely requirable
// during Railway's build step, same reasoning as before.
// ---------------------------------------------------------------------------
const assetsDir = path.join(__dirname, 'assets');
const logosDir = path.join(__dirname, 'assets', 'logos');

module.exports = { assetsDir, logosDir };
