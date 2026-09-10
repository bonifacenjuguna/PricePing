const { Pool } = require('pg');
const config = require('../config');
const logger = require('../lib/logger');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Fired on idle-client background errors (e.g. connection dropped by the
  // server) — must be handled or an unhandled 'error' event crashes the
  // whole process. Log and let the pool recover/reconnect on next query.
  logger.error('Postgres pool error', { message: err.message });
});

async function close() {
  await pool.end();
}

module.exports = { pool, close };
