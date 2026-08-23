const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const config = require('../src/config');

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filenames are numerically prefixed (001_, 002_, ...) so lexical sort == apply order

  for (const file of files) {
    console.log(`Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }

  console.log('Seeding default thresholds (only for symbols not already set)...');
  for (const [symbol, thresholdUsd] of Object.entries(config.defaultThresholds)) {
    await pool.query(
      `INSERT INTO thresholds (symbol, threshold_usd, threshold_type)
       VALUES ($1, $2, 'usd')
       ON CONFLICT (symbol) DO NOTHING`,
      [symbol, thresholdUsd]
    );
    await pool.query(
      `INSERT INTO coin_state (symbol)
       VALUES ($1)
       ON CONFLICT (symbol) DO NOTHING`,
      [symbol]
    );
  }

  console.log('Seeding default settings (only if missing)...');
  const defaultSettings = { paused: 'false', announcement_sent: 'false' };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }

  console.log('Migration complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
