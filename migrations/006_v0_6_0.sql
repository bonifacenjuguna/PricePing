-- PricePing v0.6.0 schema additions — all additive/idempotent.

-- Command usage analytics — which commands actually get used.
CREATE TABLE IF NOT EXISTS command_usage (
  command      TEXT PRIMARY KEY,
  count        INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ
);

-- Digest schedules can now optionally list which symbols to include
-- (comma-separated, e.g. "BTC,ETH") — NULL/absent means "every coin",
-- preserving current behavior for existing schedules.
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS symbols TEXT;
