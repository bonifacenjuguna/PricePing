-- PricePing v1.0.0 schema additions — all additive/idempotent, safe to run
-- against the existing production database. Nothing from prior migrations
-- (channels, settings, templates, custom_vars, etc.) is altered or dropped.

-- Replaces the old static coin list + manual /addcoin flow. Populated and
-- kept in sync automatically by services/binanceSync.js. threshold_value/
-- threshold_type start at the tier default computed at sync time, but are
-- an owner-editable override from then on (sync never overwrites them once
-- set — see db/coins.js upsertFromSync).
CREATE TABLE IF NOT EXISTS coins (
  symbol            TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  binance_pair      TEXT NOT NULL,
  color             TEXT NOT NULL,
  is_stable         BOOLEAN NOT NULL DEFAULT false,
  milestone_step    NUMERIC,
  tier              TEXT NOT NULL DEFAULT 'mid',
  threshold_value   NUMERIC NOT NULL,
  threshold_type    TEXT NOT NULL DEFAULT 'pct',
  muted             BOOLEAN NOT NULL DEFAULT false,
  last_price        NUMERIC,
  last_alert_price  NUMERIC,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-channel opt-out of specific post types. A channel with no rows here
-- for a given post_type is treated as enabled (see db/channels.js
-- getPostTypeToggles) — an owner opts a channel OUT of noise, not in.
CREATE TABLE IF NOT EXISTS channel_post_types (
  channel_name  TEXT NOT NULL REFERENCES channels(name) ON DELETE CASCADE,
  post_type     TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (channel_name, post_type)
);
