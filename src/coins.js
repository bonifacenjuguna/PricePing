const path = require('path');

// ---------------------------------------------------------------------------
// Coin list — see full field docs in config.js. Deliberately has NO
// dependency on environment variables so it can be safely required by
// scripts/prepare-assets.js during Railway's build step, before runtime
// env vars (DATABASE_URL, REDIS_URL, etc., especially Railway's plugin
// reference variables) are necessarily resolved.
//
// milestoneStep: round-number spacing used for milestone alerts (e.g. BTC
// crossing every $10,000). null disables milestone alerts for that coin
// (stablecoins — a "milestone" at $1.00 is meaningless noise).
// ---------------------------------------------------------------------------
const coins = [
  { symbol: 'BTC', name: 'Bitcoin', binancePair: 'BTCUSDT', color: '#F7931A', isStable: false, milestoneStep: 10000 },
  { symbol: 'ETH', name: 'Ethereum', binancePair: 'ETHUSDT', color: '#627EEA', isStable: false, milestoneStep: 500 },
  { symbol: 'BNB', name: 'BNB', binancePair: 'BNBUSDT', color: '#F0B90B', isStable: false, milestoneStep: 50 },
  { symbol: 'SOL', name: 'Solana', binancePair: 'SOLUSDT', color: '#9945FF', isStable: false, milestoneStep: 20 },
  { symbol: 'XRP', name: 'XRP', binancePair: 'XRPUSDT', color: '#23292F', isStable: false, milestoneStep: 0.5 },
  { symbol: 'TRX', name: 'TRON', binancePair: 'TRXUSDT', color: '#EF0027', isStable: false, milestoneStep: 0.05 },
  { symbol: 'DOGE', name: 'Dogecoin', binancePair: 'DOGEUSDT', color: '#C2A633', isStable: false, milestoneStep: 0.05 },
  { symbol: 'XAUT', name: 'Tether Gold', binancePair: 'XAUTUSDT', color: '#D4AF37', isStable: false, milestoneStep: 100 },
  { symbol: 'USDC', name: 'USD Coin', binancePair: 'USDCUSDT', color: '#2775CA', isStable: true, milestoneStep: null },
  {
    symbol: 'USDT',
    name: 'Tether',
    binancePair: null,
    impliedFromInverse: 'USDCUSDT',
    color: '#26A17B',
    isStable: true,
    milestoneStep: null,
  },
];

const defaultThresholds = {
  BTC: 500,
  ETH: 50,
  BNB: 5,
  SOL: 2,
  XRP: 0.02,
  TRX: 0.005,
  DOGE: 0.002,
  USDT: 0.003,
  USDC: 0.003,
  XAUT: 25,
};

const assetsDir = path.join(__dirname, 'assets');
const logosDir = path.join(__dirname, 'assets', 'logos');

module.exports = { coins, defaultThresholds, assetsDir, logosDir };
