-- Users: per-user settings (timezone, card style, clock format)
CREATE TABLE IF NOT EXISTS users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  time_format TEXT NOT NULL DEFAULT '24h', -- '12h' | '24h'
  card_style TEXT NOT NULL DEFAULT 'compact', -- 'compact' | 'loose'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Channels the bot posts to (added as admin). One bot can serve many
-- channels, each with its own coin set / thresholds / mute state via the
-- per-channel tables below.
CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  title TEXT,
  added_by BIGINT REFERENCES users(telegram_id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  digest_mode BOOLEAN NOT NULL DEFAULT false,
  digest_interval_minutes INT NOT NULL DEFAULT 60,
  quiet_hours_start SMALLINT, -- 0-23, local to the channel's configured timezone
  quiet_hours_end SMALLINT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-channel, per-coin config: mute state, threshold override, milestone
-- step override, cooldown override. A row only exists once something has
-- been customized away from the factory default in src/coins.js — absence
-- of a row means "use factory defaults", same pattern as PricePing's
-- milestone_overrides table.
CREATE TABLE IF NOT EXISTS coin_settings (
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  muted BOOLEAN NOT NULL DEFAULT false,
  threshold_type TEXT DEFAULT 'pct', -- 'pct' | 'usd'
  threshold_value NUMERIC,
  milestone_step NUMERIC,
  milestone_disabled BOOLEAN NOT NULL DEFAULT false,
  cooldown_minutes INT,
  on_watchlist BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, symbol)
);

-- Live state per channel+coin: last alerted price/milestone, used to decide
-- whether a new tick qualifies for an alert. Separate from coin_settings
-- (config) so state churns independently of user-edited config.
CREATE TABLE IF NOT EXISTS coin_state (
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  last_price NUMERIC,
  last_alert_price NUMERIC,
  last_alert_at TIMESTAMPTZ,
  last_milestone NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, symbol)
);

-- Alert history / audit log — also doubles as milestone dedup evidence if
-- ever needed to debug a false-fire report.
CREATE TABLE IF NOT EXISTS alerts_log (
  id SERIAL PRIMARY KEY,
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  alert_type TEXT NOT NULL, -- 'threshold' | 'milestone'
  price NUMERIC NOT NULL,
  detail JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Coin logos stored as blobs — source of truth surviving Railway's
-- ephemeral filesystem. Synced to local disk (src/assets/logos/*.png) on
-- boot by scripts/prepare-assets.js / services/logoSync.js.
CREATE TABLE IF NOT EXISTS logos (
  symbol TEXT PRIMARY KEY,
  png_data BYTEA NOT NULL,
  source TEXT NOT NULL, -- 'coingecko' | 'fallback'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Data-source health tracking, feeds the Settings -> Status screen and the
-- boot-time self-check / admin-alert-on-repeated-failure logic.
CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INT NOT NULL DEFAULT 0,
  admin_notified BOOLEAN NOT NULL DEFAULT false
);

-- Font files stored as blobs — same rationale as `logos`: survives
-- Railway's ephemeral filesystem across redeploys. Synced to local disk
-- (src/assets/fonts/*.ttf) on boot by services/fontSync.js.
CREATE TABLE IF NOT EXISTS fonts (
  filename TEXT PRIMARY KEY,
  font_data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_log_channel_symbol ON alerts_log (channel_id, symbol, sent_at DESC);
