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
    .sort(); // filenames are numerically prefixed so lexical sort == apply order

  for (const file of files) {
    console.log(`Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }

  console.log('Seeding primary channel ("main" = CHANNEL_ID env var)...');
  await pool.query(
    `INSERT INTO channels (name, chat_id, is_default)
     VALUES ('main', $1, true)
     ON CONFLICT (name) DO UPDATE SET chat_id = EXCLUDED.chat_id`,
    [config.channelId]
  );
  const postTypes = ['threshold', 'milestone', 'manual', 'chart', 'movers', 'feargreed', 'digest'];
  for (const postType of postTypes) {
    await pool.query(
      `INSERT INTO channel_post_types (channel_name, post_type, enabled) VALUES ('main', $1, true)
       ON CONFLICT (channel_name, post_type) DO NOTHING`,
      [postType]
    );
  }

  console.log('Seeding bot mode + timezone defaults (only if not already set)...');
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('bot_mode', $1) ON CONFLICT (key) DO NOTHING`,
    [config.defaultBotMode]
  );
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('timezone', $1) ON CONFLICT (key) DO NOTHING`,
    [config.defaultTimezone]
  );

  console.log(
    'Note: coins are no longer seeded here — run the Binance sync ' +
      '(automatic on boot, or "🔄 Force Sync Now" in the bot menu) to populate the coins table.'
  );

  console.log('Migration complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
