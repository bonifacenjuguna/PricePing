-- PricePing v0.3.0 schema additions
-- All additive/idempotent — safe to run on every boot alongside 001/002.

-- Named channel registry. Replaces the old single "secondary channel"
-- setting with a real list — every post-capable command can now target
-- one channel by name instead of everything mirroring everywhere.
CREATE TABLE IF NOT EXISTS channels (
  name       TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Caption text templates, one per alert type. NULL/missing row means "use
-- the built-in default" — see src/services/templateEngine.js.
CREATE TABLE IF NOT EXISTS caption_templates (
  alert_type TEXT PRIMARY KEY,
  template   TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin-defined named variables usable inside any caption template
-- alongside the built-in ones, e.g. {mymessage}.
CREATE TABLE IF NOT EXISTS custom_vars (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recurring automated posts/charts (not digests — the daily digest keeps
-- its own env-var-driven schedule in services/digest.js).
CREATE TABLE IF NOT EXISTS schedules (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('post', 'chart')),
  symbol        TEXT NOT NULL,
  period        TEXT,                 -- chart period key, e.g. '24h' — NULL for kind='post'
  channel_name  TEXT NOT NULL REFERENCES channels(name) ON DELETE CASCADE,
  cadence       TEXT NOT NULL CHECK (cadence IN ('hourly', 'daily', 'weekly')),
  at_minute_utc INT NOT NULL DEFAULT 0,   -- minute-of-hour for hourly; minute-of-day-hour otherwise
  at_hour_utc   INT,                       -- required for daily/weekly
  day_of_week   INT,                       -- required for weekly (0=Sunday, matches JS getUTCDay())
  last_run_key  TEXT,                      -- dedupe token so a 5-min check loop never double-fires
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Simple trigger -> action automation rules, evaluated right after an
-- alert successfully sends (see poller.js). action_params is free-form
-- JSON whose shape depends on action_type (documented in rules.js).
CREATE TABLE IF NOT EXISTS rules (
  id             SERIAL PRIMARY KEY,
  trigger_type   TEXT NOT NULL CHECK (trigger_type IN ('threshold', 'milestone', 'any_alert')),
  trigger_symbol TEXT,               -- NULL = matches any symbol
  action_type    TEXT NOT NULL CHECK (action_type IN ('mirror', 'post_chart', 'broadcast')),
  action_params  JSONB NOT NULL DEFAULT '{}',
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every alert/post now records which channel it actually went to.
ALTER TABLE alerts_log ADD COLUMN IF NOT EXISTS channel_name TEXT NOT NULL DEFAULT 'main';
