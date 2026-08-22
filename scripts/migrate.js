const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const config = require('../src/config');

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });

  const sqlPath = path.join(__dirname, '..', 'migrations', '001_init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Applying schema...');
  await pool.query(sql);

  console.log('Seeding default thresholds (only for symbols not already set)...');
  for (const [symbol, thresholdUsd] of Object.entries(config.defaultThresholds)) {
    await pool.query(
      `INSERT INTO thresholds (symbol, threshold_usd)
       VALUES ($1, $2)
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
