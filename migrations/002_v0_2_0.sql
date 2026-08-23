-- PricePing v0.2.0 schema additions
-- All additive/idempotent — safe to run on every boot alongside 001_init.sql.

-- Threshold type: 'usd' (absolute move) or 'pct' (percentage move since last alert).
ALTER TABLE thresholds ADD COLUMN IF NOT EXISTS threshold_type TEXT NOT NULL DEFAULT 'usd';
ALTER TABLE thresholds DROP CONSTRAINT IF EXISTS thresholds_threshold_type_check;
ALTER TABLE thresholds ADD CONSTRAINT thresholds_threshold_type_check
  CHECK (threshold_type IN ('usd', 'pct'));

-- Per-coin mute (independent of global pause) and milestone-crossing tracking.
ALTER TABLE coin_state ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;
ALTER TABLE coin_state ADD COLUMN IF NOT EXISTS last_milestone NUMERIC;

-- Distinguishes threshold alerts from manual posts / milestone crossings in
-- /history and /stats.
ALTER TABLE alerts_log ADD COLUMN IF NOT EXISTS alert_type TEXT NOT NULL DEFAULT 'threshold';

-- Runtime-added coins (via /addcoin) live here; merged into the in-memory
-- coin list on boot by src/services/coinRegistry.js. The original 10 coins
-- in src/coins.js are unaffected and always load first.
CREATE TABLE IF NOT EXISTS custom_coins (
  symbol       TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  binance_pair TEXT NOT NULL,
  color        TEXT NOT NULL,
  is_stable    BOOLEAN NOT NULL DEFAULT false,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row heartbeat the poller touches every successful tick. Watched by
-- src/services/heartbeatWatchdog.js so a silently-stuck poller (process
-- alive, loop dead) gets caught instead of failing invisibly.
CREATE TABLE IF NOT EXISTS heartbeat (
  id           INT PRIMARY KEY DEFAULT 1,
  last_tick_at TIMESTAMPTZ,
  last_tick_ms INT,
  CONSTRAINT heartbeat_single_row CHECK (id = 1)
);
INSERT INTO heartbeat (id, last_tick_at) VALUES (1, now()) ON CONFLICT (id) DO NOTHING;
