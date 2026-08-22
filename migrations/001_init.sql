-- PricePing schema
-- Postgres is the single source of truth for anything that must survive a
-- restart. Nothing here is cached in-process across ticks (see poller.js).

CREATE TABLE IF NOT EXISTS thresholds (
  symbol       TEXT PRIMARY KEY,
  threshold_usd NUMERIC NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tracks the last price seen and the last price an alert actually fired on,
-- per coin. last_alert_price is what threshold comparisons run against.
-- last_alert_at backs the per-coin cooldown window.
CREATE TABLE IF NOT EXISTS coin_state (
  symbol           TEXT PRIMARY KEY,
  last_price       NUMERIC,
  last_alert_price NUMERIC,
  last_alert_at    TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per channel post. Backs /status and the Stats menu screen.
CREATE TABLE IF NOT EXISTS alerts_log (
  id         SERIAL PRIMARY KEY,
  symbol     TEXT NOT NULL,
  price      NUMERIC NOT NULL,
  change_usd NUMERIC NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_log_created_at ON alerts_log (created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_log_symbol ON alerts_log (symbol);

-- Small generic key/value store: paused state, one-time announcement flag,
-- anything else that's a single toggle rather than a real table.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Boot/error/memory-restart audit trail, shown in /status.
CREATE TABLE IF NOT EXISTS events (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL,
  message    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
