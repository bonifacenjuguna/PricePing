// Tracks call counts per source in Redis with a rolling window, so
// marketData.js can proactively skip to the next fallback BEFORE getting
// 429'd, not just react after. Each source's budget is deliberately
// conservative (well under the documented free-tier ceiling) since we'd
// rather fail over a little early than get temporarily banned.
const redisDb = require('../db/redis');

// { windowSeconds, maxCalls } per source — conservative vs each API's
// documented free-tier limits.
const BUDGETS = {
  binance: { windowSeconds: 60, maxCalls: 1000 }, // Binance's weight-based limit is generous; this is a soft app-level cap
  kraken: { windowSeconds: 60, maxCalls: 15 },
  coingecko: { windowSeconds: 60, maxCalls: 25 }, // keyless tier ~10-30/min
  coinpaprika: { windowSeconds: 60, maxCalls: 20 },
  coinlore: { windowSeconds: 60, maxCalls: 60 },
  geckoterminal: { windowSeconds: 60, maxCalls: 25 },
  feargreed: { windowSeconds: 60, maxCalls: 10 },
};

// Returns true if calling `source` right now is within budget. Increments
// the counter as a side effect (so checking IS the reservation — avoids a
// separate check-then-increment race).
async function tryConsume(source) {
  const budget = BUDGETS[source];
  if (!budget) return true; // unknown source — no configured limit, allow
  const redis = redisDb.getClient();
  const key = `ratelimit:${source}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, budget.windowSeconds);
  return count <= budget.maxCalls;
}

async function remaining(source) {
  const budget = BUDGETS[source];
  if (!budget) return Infinity;
  const redis = redisDb.getClient();
  const count = parseInt((await redis.get(`ratelimit:${source}`)) || '0', 10);
  return Math.max(0, budget.maxCalls - count);
}

module.exports = { tryConsume, remaining, BUDGETS };
