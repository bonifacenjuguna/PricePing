// Short-TTL cache so N users tapping "Price" within the same few seconds
// share one upstream call instead of each firing a fresh request. Cache
// key includes enough detail to be safe (source + endpoint + params).
const redisDb = require('../db/redis');

async function getOrFetch(key, ttlSeconds, fetchFn) {
  const redis = redisDb.getClient();
  const cached = await redis.get(`cache:${key}`);
  if (cached) return JSON.parse(cached);

  const fresh = await fetchFn();
  await redis.set(`cache:${key}`, JSON.stringify(fresh), 'EX', ttlSeconds);
  return fresh;
}

module.exports = { getOrFetch };
