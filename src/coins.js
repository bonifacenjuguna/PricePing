// The fixed 22-asset universe (20 coins + USDT + USDC), plus per-coin
// defaults. Deliberately has NO dependency on config.js or any env var —
// scripts/prepare-assets.js needs to run at build time, before
// DATABASE_URL/REDIS_URL are necessarily available, and config.js hard-
// exits if those are missing. Keeping this file dependency-free means the
// asset-prep step always works regardless of what point in the deploy
// pipeline it runs at.
//
// milestoneStep: default $ step for milestone alerts (e.g. BTC every
// $1,000). null for stablecoins — they don't get milestones, their price
// barely moves. These are FACTORY defaults; DB overrides (milestone_overrides
// table) take precedence at runtime, same pattern as PricePing.
//
// color: brand hex, used for the card background gradient (see
// cardRenderer.js — shade() lightens/darkens this for the gradient stops).
const path = require('path');

// geckoId: CoinGecko coin ID, used for market-data lookups (fetchMarketData)
// and as the logo source (fetchMarkets returns a ready `image` URL).
// coinloreId: CoinLore's numeric ticker ID, used only for the cross-source
// milestone sanity-check when a coin has no Kraken pair to compare against.
const coins = [
  { symbol: 'BTC', name: 'Bitcoin', binancePair: 'BTCUSDT', krakenPair: 'XBTUSDT', geckoId: 'bitcoin', coinloreId: '90', color: '#F7931A', milestoneStep: 1000, defaultThresholdPct: 2, isStable: false },
  { symbol: 'ETH', name: 'Ethereum', binancePair: 'ETHUSDT', krakenPair: 'ETHUSDT', geckoId: 'ethereum', coinloreId: '80', color: '#627EEA', milestoneStep: 100, defaultThresholdPct: 2.5, isStable: false },
  { symbol: 'BNB', name: 'BNB', binancePair: 'BNBUSDT', krakenPair: null, geckoId: 'binancecoin', coinloreId: '2710', color: '#F3BA2F', milestoneStep: 25, defaultThresholdPct: 3, isStable: false },
  { symbol: 'XRP', name: 'XRP', binancePair: 'XRPUSDT', krakenPair: 'XRPUSDT', geckoId: 'ripple', coinloreId: '58', color: '#25A768', milestoneStep: 0.1, defaultThresholdPct: 3, isStable: false },
  { symbol: 'SOL', name: 'Solana', binancePair: 'SOLUSDT', krakenPair: 'SOLUSDT', geckoId: 'solana', coinloreId: '48543', color: '#14F195', milestoneStep: 10, defaultThresholdPct: 3.5, isStable: false },
  { symbol: 'TRX', name: 'Tron', binancePair: 'TRXUSDT', krakenPair: null, geckoId: 'tron', coinloreId: '2713', color: '#EF0027', milestoneStep: 0.01, defaultThresholdPct: 3, isStable: false },
  { symbol: 'HYPE', name: 'Hyperliquid', binancePair: 'HYPEUSDT', krakenPair: null, geckoId: 'hyperliquid', coinloreId: null, color: '#0F1A2B', milestoneStep: 1, defaultThresholdPct: 5, isStable: false },
  { symbol: 'ZEC', name: 'Zcash', binancePair: 'ZECUSDT', krakenPair: 'ZECUSDT', geckoId: 'zcash', coinloreId: '74', color: '#ECB244', milestoneStep: 5, defaultThresholdPct: 4, isStable: false },
  { symbol: 'DOGE', name: 'Dogecoin', binancePair: 'DOGEUSDT', krakenPair: 'DOGEUSDT', geckoId: 'dogecoin', coinloreId: '2', color: '#C2A633', milestoneStep: 0.01, defaultThresholdPct: 4, isStable: false },
  { symbol: 'XMR', name: 'Monero', binancePair: 'XMRUSDT', krakenPair: 'XMRUSDT', geckoId: 'monero', coinloreId: '28', color: '#FF6600', milestoneStep: 5, defaultThresholdPct: 3.5, isStable: false },
  { symbol: 'LINK', name: 'Chainlink', binancePair: 'LINKUSDT', krakenPair: 'LINKUSDT', geckoId: 'chainlink', coinloreId: '1975', color: '#2A5ADA', milestoneStep: 1, defaultThresholdPct: 3.5, isStable: false },
  { symbol: 'LEO', name: 'UNUS SED LEO', binancePair: null, krakenPair: null, geckoId: 'leo-token', coinloreId: '3987', color: '#141414', milestoneStep: 0.05, defaultThresholdPct: 3, isStable: false },
  { symbol: 'ADA', name: 'Cardano', binancePair: 'ADAUSDT', krakenPair: 'ADAUSDT', geckoId: 'cardano', coinloreId: '2010', color: '#0033AD', milestoneStep: 0.05, defaultThresholdPct: 4, isStable: false },
  { symbol: 'XLM', name: 'Stellar', binancePair: 'XLMUSDT', krakenPair: 'XLMUSDT', geckoId: 'stellar', coinloreId: '512', color: '#14B6E7', milestoneStep: 0.02, defaultThresholdPct: 4, isStable: false },
  { symbol: 'BCH', name: 'Bitcoin Cash', binancePair: 'BCHUSDT', krakenPair: 'BCHUSDT', geckoId: 'bitcoin-cash', coinloreId: '1831', color: '#8DC351', milestoneStep: 25, defaultThresholdPct: 3.5, isStable: false },
  { symbol: 'LTC', name: 'Litecoin', binancePair: 'LTCUSDT', krakenPair: 'LTCUSDT', geckoId: 'litecoin', coinloreId: '1', color: '#345D9D', milestoneStep: 5, defaultThresholdPct: 3.5, isStable: false },
  { symbol: 'UNI', name: 'Uniswap', binancePair: 'UNIUSDT', krakenPair: 'UNIUSDT', geckoId: 'uniswap', coinloreId: '39678', color: '#FF007A', milestoneStep: 1, defaultThresholdPct: 4, isStable: false },
  // NOTE: TON rebranded to "Gram"(GRAM) after this bot's data was last verified —
  // double-check the Binance/Kraken pair symbol and CoinGecko/CoinLore IDs are
  // still current before relying on this row; kept as TON's known IDs for now.
  { symbol: 'GRAM', name: 'Gram (TON)', binancePair: 'TONUSDT', krakenPair: null, geckoId: 'the-open-network', coinloreId: null, color: '#0098EA', milestoneStep: 0.25, defaultThresholdPct: 4, isStable: false },
  { symbol: 'HBAR', name: 'Hedera', binancePair: 'HBARUSDT', krakenPair: null, geckoId: 'hedera-hashgraph', coinloreId: '4642', color: '#000000', milestoneStep: 0.02, defaultThresholdPct: 4, isStable: false },
  { symbol: 'AVAX', name: 'Avalanche', binancePair: 'AVAXUSDT', krakenPair: 'AVAXUSDT', geckoId: 'avalanche-2', coinloreId: '44883', color: '#E84142', milestoneStep: 2, defaultThresholdPct: 4, isStable: false },
  { symbol: 'USDT', name: 'Tether', binancePair: null, krakenPair: null, geckoId: 'tether', coinloreId: '518', color: '#26A17B', milestoneStep: null, defaultThresholdPct: null, isStable: true },
  { symbol: 'USDC', name: 'USD Coin', binancePair: 'USDCUSDT', krakenPair: 'USDCUSDT', geckoId: 'usd-coin', coinloreId: '3408', color: '#2775CA', milestoneStep: null, defaultThresholdPct: null, isStable: true },
];

const bySymbol = new Map(coins.map((c) => [c.symbol, c]));

module.exports = {
  coins,
  bySymbol,
  logosDir: path.join(__dirname, 'assets', 'logos'),
  fontsDir: path.join(__dirname, 'assets', 'fonts'),
};
