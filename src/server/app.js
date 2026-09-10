const express = require('express');
const { pool } = require('../db/postgres');
const redisDb = require('../db/redis');
const logger = require('../lib/logger');

// Health check ping cache — avoids re-pinging both DBs on every single hit
// (Railway's own health checks can be frequent).
let cached = null;
let cachedAt = 0;
const CACHE_MS = 5000;

function createApp() {
  const app = express();

  app.get('/health', async (req, res) => {
    if (cached && Date.now() - cachedAt < CACHE_MS) return res.status(cached.ok ? 200 : 503).json(cached);

    const result = { ok: true, checks: {} };
    try {
      await pool.query('SELECT 1');
      result.checks.postgres = 'ok';
    } catch (err) {
      result.ok = false;
      result.checks.postgres = `error: ${err.message}`;
    }
    try {
      await redisDb.getClient().ping();
      result.checks.redis = 'ok';
    } catch (err) {
      result.ok = false;
      result.checks.redis = `error: ${err.message}`;
    }

    cached = result;
    cachedAt = Date.now();
    if (!result.ok) logger.warn('Health check failing', result.checks);
    res.status(result.ok ? 200 : 503).json(result);
  });

  return app;
}

module.exports = { createApp };
