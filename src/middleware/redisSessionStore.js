// Telegraf session middleware backed by Redis instead of in-memory, so
// session state (navStack, multi-select state, pending-input flags)
// survives a bot restart/redeploy instead of silently resetting every
// user's navigation mid-flow.
const { session } = require('telegraf');
const redisDb = require('../db/redis');

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days of inactivity before a session is dropped

function redisStore() {
  return {
    async get(key) {
      const redis = redisDb.getClient();
      const raw = await redis.get(`session:${key}`);
      return raw ? JSON.parse(raw) : undefined;
    },
    async set(key, value) {
      const redis = redisDb.getClient();
      await redis.set(`session:${key}`, JSON.stringify(value), 'EX', SESSION_TTL_SECONDS);
    },
    async delete(key) {
      const redis = redisDb.getClient();
      await redis.del(`session:${key}`);
    },
  };
}

function sessionMiddleware() {
  return session({ store: redisStore(), defaultSession: () => ({ navStack: [{ screen: 'home', params: {} }] }) });
}

module.exports = { sessionMiddleware };
