const { redis } = require('../db/redis');

const KEY = 'priceping:pendinginput';
const TTL_SECONDS = 15 * 60; // 15 min — stale free-text states auto-expire rather than lingering forever

// action: a string like 'threshold:override:BTC', 'channel:add',
// 'format:setnew:threshold', 'timezone:set', 'post:search'. Whatever
// handler set it is responsible for interpreting it when the reply lands.
async function set(action) {
  await redis.set(KEY, action, 'EX', TTL_SECONDS);
}

async function get() {
  return redis.get(KEY);
}

async function clear() {
  await redis.del(KEY);
}

module.exports = { set, get, clear };
