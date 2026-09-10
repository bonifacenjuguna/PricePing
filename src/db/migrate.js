const fs = require('fs');
const path = require('path');
const { pool } = require('./postgres');
const logger = require('../lib/logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT filename FROM _migrations');
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info('Applying migration', { file });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Migration failed', { file, message: err.message });
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info('Migrations up to date', { total: files.length });
}

module.exports = { migrate };
