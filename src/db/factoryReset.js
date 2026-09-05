const { pool } = require('./pool');

// Every table that exists across all migrations (see migrations/*.sql).
// Kept as an explicit list rather than querying information_schema so a
// reset can never accidentally pick up some future unrelated table this
// bot doesn't own if it ever shares a database.
const TABLES_TO_WIPE = [
  'alerts_log',
  'autosync_runs',
  'caption_templates',
  'channels',
  'coin_meta',
  'coin_state',
  'coin_tags',
  'command_usage',
  'cooldown_overrides',
  'custom_coins',
  'custom_vars',
  'default_channels_by_type',
  'events',
  'heartbeat',
  'held_back_alerts',
  'milestone_overrides',
  'rules',
  'schedules',
  'settings',
  'thresholds',
];

// TRUNCATE (not DELETE) — instant regardless of table size, and
// RESTART IDENTITY so any serial id columns (events, schedules, rules,
// autosync_runs, held_back_alerts) start back at 1, same as a brand new
// database. CASCADE handles the FK from schedules/rules etc. to channels.
async function wipeAllTables() {
  await pool.query(`TRUNCATE TABLE ${TABLES_TO_WIPE.join(', ')} RESTART IDENTITY CASCADE`);
}

module.exports = { wipeAllTables, TABLES_TO_WIPE };
