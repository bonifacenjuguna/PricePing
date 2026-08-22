// ---------------------------------------------------------------------------
// Coin list
// ---------------------------------------------------------------------------
// binancePair: the exact symbol string passed to Binance's public REST API.
// color: known brand hex color, used as the SVG card background/accent.
// isStable: true for USDT/USDC — these show price-only in the channel
//           caption (no % badge), per design.
// impliedFromInverse: for USDT specifically — Binance's spot market has no
//   direct USDT/USD ticker (USDT is the de-facto quote currency for almost
//   every other pair, so it has no independent USD price of its own on
//   Binance). We approximate USDT's USD price as the mathematical inverse
//   of USDCUSDT (USDC's price in USDT terms), since USDC is itself ~$1.
//   This is a reasonable peg-health proxy, NOT a real independent price
//   feed. It's called out here, in the README, and in binance.js so it's
//   never mistaken for a "real" ticker.
//
// This module is intentionally free of any environment/config dependencies
// so it can be safely required at build time (e.g. scripts/prepare-assets.js)
// without needing DATABASE_URL, REDIS_URL, or any other runtime secrets.
const coins = [
  { symbol: 'BTC', name: 'Bitcoin', binancePair: 'BTCUSDT', color: '#F7931A', isStable: false },
  { symbol: 'ETH', name: 'Ethereum', binancePair: 'ETHUSDT', color: '#627EEA', isStable: false },
  { symbol: 'BNB', name: 'BNB', binancePair: 'BNBUSDT', color: '#F0B90B', isStable: false },
  { symbol: 'SOL', name: 'Solana', binancePair: 'SOLUSDT', color: '#9945FF', isStable: false },
  { symbol: 'XRP', name: 'XRP', binancePair: 'XRPUSDT', color: '#23292F', isStable: false },
  { symbol: 'TRX', name: 'TRON', binancePair: 'TRXUSDT', color: '#EF0027', isStable: false },
  { symbol: 'DOGE', name: 'Dogecoin', binancePair: 'DOGEUSDT', color: '#C2A633', isStable: false },
  { symbol: 'XAUT', name: 'Tether Gold', binancePair: 'XAUTUSDT', color: '#D4AF37', isStable: false },
  { symbol: 'USDC', name: 'USD Coin', binancePair: 'USDCUSDT', color: '#2775CA', isStable: true },
  {
    symbol: 'USDT',
    name: 'Tether',
    binancePair: null, // no direct pair — see impliedFromInverse note above
    impliedFromInverse: 'USDCUSDT',
    color: '#26A17B',
    isStable: true,
  },
];

// Default thresholds (USD, absolute move) — seeded into Postgres on first
// migration. After that, Postgres is the source of truth; these defaults
// are never read again at runtime.
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

module.exports = {
  coins,
  defaultThresholds,
};
