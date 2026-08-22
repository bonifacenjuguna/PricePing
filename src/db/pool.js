const { Pool } = require('pg');
const config = require('../config');

// Small cap — a single-admin bot never needs more than a couple of
// concurrent queries. Keeping this low keeps per-connection overhead off
// the 512MB memory budget.
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  // A background idle-client error should never crash the process.
  // eslint-disable-next-line no-console
  console.error('Unexpected Postgres pool error', err.message);
});

module.exports = { pool };
