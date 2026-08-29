const { pool } = require('./pool');

async function increment(command) {
  await pool.query(
    `INSERT INTO command_usage (command, count, last_used_at) VALUES ($1, 1, now())
     ON CONFLICT (command) DO UPDATE SET count = command_usage.count + 1, last_used_at = now()`,
    [command]
  );
}

async function getAll() {
  const { rows } = await pool.query('SELECT command, count, last_used_at FROM command_usage ORDER BY count DESC');
  return rows;
}

module.exports = { increment, getAll };
