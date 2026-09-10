const Redis = require('ioredis');
const config = require('../config');
const logger = require('../lib/logger');

let client = null;

function connect() {
  return new Promise((resolve, reject) => {
    client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    client.on('error', (err) => logger.error('Redis error', { message: err.message }));
    client.once('ready', () => {
      logger.info('Redis connected');
      resolve(client);
    });
    client.once('end', () => {});
    // Don't hang startup forever if Redis is unreachable
    const timeout = setTimeout(() => reject(new Error('Redis connect timed out')), 10000);
    client.once('ready', () => clearTimeout(timeout));
  });
}

function getClient() {
  if (!client) throw new Error('Redis not connected yet — call connect() first');
  return client;
}

async function close() {
  if (client) {
    // quit() can hang under certain reconnect states (documented gotcha —
    // see index.js shutdown sequence, which wraps this in its own timeout
    // anyway as a second line of defense).
    await client.quit();
  }
}

module.exports = { connect, getClient, close };
