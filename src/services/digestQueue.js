// When a channel has digest_mode enabled, individual alerts don't post
// immediately — they queue here (a Redis list per channel) and
// digestScheduler.js flushes the queue as one combined summary message on
// the channel's configured interval. Quiet hours still apply on top: a
// flush due during quiet hours is simply skipped and the queue keeps
// growing until the next check after quiet hours end.
const redisDb = require('../db/redis');

function queueKey(channelId) {
  return `digest:queue:${channelId}`;
}

function lastFlushKey(channelId) {
  return `digest:lastflush:${channelId}`;
}

async function enqueue(channelId, entry) {
  const redis = redisDb.getClient();
  await redis.rpush(queueKey(channelId), JSON.stringify({ ...entry, queuedAt: Date.now() }));
}

async function peekAll(channelId) {
  const redis = redisDb.getClient();
  const raw = await redis.lrange(queueKey(channelId), 0, -1);
  return raw.map((r) => JSON.parse(r));
}

async function clear(channelId) {
  const redis = redisDb.getClient();
  await redis.del(queueKey(channelId));
}

async function queueLength(channelId) {
  const redis = redisDb.getClient();
  return redis.llen(queueKey(channelId));
}

async function getLastFlushAt(channelId) {
  const redis = redisDb.getClient();
  const raw = await redis.get(lastFlushKey(channelId));
  return raw ? parseInt(raw, 10) : 0;
}

async function setLastFlushNow(channelId) {
  const redis = redisDb.getClient();
  await redis.set(lastFlushKey(channelId), String(Date.now()));
}

module.exports = { enqueue, peekAll, clear, queueLength, getLastFlushAt, setLastFlushNow };
