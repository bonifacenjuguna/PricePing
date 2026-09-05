-- PricePing v0.9.0 schema additions — all additive/idempotent.

-- Visible log of alerts held back by the hourly send cap (see
-- poller.js) — "we should have a place to put them" instead of just a
-- fire-and-forget warning message with no way to see what was affected.
CREATE TABLE IF NOT EXISTS held_back_alerts (
  id          SERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL,
  alert_type  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
