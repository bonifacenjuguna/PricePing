const { pool } = require('./pool');

async function record(type, message) {
  try {
    await pool.query('INSERT INTO events (type, message) VALUES ($1, $2)', [type, message]);
  } catch (err) {
    // Never let event logging itself take the process down.
    // eslint-disable-next-line no-console
    console.error('Failed to record event', err.message);
  }
}

async function latest(limit = 5) {
  const { rows } = await pool.query(
    'SELECT type, message, created_at FROM events ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = { record, latest };
