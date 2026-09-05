-- PricePing v0.11.0 — Bot Modes support.

-- Distinguishes a threshold the admin explicitly set (via /setthreshold,
-- bulk-set, or import) from one that was auto-seeded when a coin was
-- added. Bot Modes (see db/settings.js) scale the seeded default up or
-- down — an explicit choice is left alone, since the admin already
-- picked that exact number on purpose. Existing rows all default to
-- false (seeded) since there's no way to know in hindsight which ones
-- were hand-tuned before this column existed; worst case an old
-- hand-tuned threshold gets mode-scaled once until touched again.
ALTER TABLE thresholds ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;
