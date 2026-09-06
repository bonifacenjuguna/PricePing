const logger = require('../utils/logger');

// Binance's edge sometimes geo-blocks or rate-limits a specific host —
// every Binance-hitting service (sync, poller, chart/klines) goes through
// this one shared client so an outage on one host doesn't leave some
// features recovered and others still dark.
const API_HOSTS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://data-api.binance.vision',
];

async function fetchWithMirrors(pathAndQuery) {
  let lastErr;
  for (const host of API_HOSTS) {
    try {
      const res = await fetch(`${host}${pathAndQuery}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      logger.warn(`Binance host ${host} failed, trying next mirror`, { message: err.message });
    }
  }
  throw lastErr;
}

module.exports = { fetchWithMirrors, API_HOSTS };
