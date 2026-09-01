-- PricePing v0.7.2 schema additions — all additive/idempotent.

-- Rules can now optionally filter by alert direction (up/down), not just
-- trigger type/symbol/minMovePct. NULL means "either direction" (previous
-- behavior, preserved for existing rules).
ALTER TABLE rules ADD COLUMN IF NOT EXISTS trigger_direction TEXT;
