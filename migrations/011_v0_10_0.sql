-- PricePing v0.10.0 schema additions — all additive/idempotent.

-- Distinguishes a coin added by hand via /addcoin from one auto-added by
-- the Binance auto-sync job (see services/coinSync.js). Existing rows all
-- default to 'manual' since that's how every one of them actually got
-- there — auto-sync didn't exist before this version. This distinction
-- matters because auto-sync is only ever allowed to remove a coin it
-- added itself; a manually-added coin (or one of the original 10, which
-- never has a custom_coins row at all) is never touched by it.
ALTER TABLE custom_coins ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- One row per auto-sync run (manual /syncnow or the periodic job), purely
-- for /autosynclog — lets the admin see what changed and when without
-- combing through the generic events table.
CREATE TABLE IF NOT EXISTS autosync_runs (
  id               SERIAL PRIMARY KEY,
  run_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  added            TEXT,    -- comma-separated symbols, NULL if none
  removed          TEXT,    -- comma-separated symbols, NULL if none
  candidates_seen  INTEGER NOT NULL DEFAULT 0,
  error            TEXT
);
