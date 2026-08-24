-- PricePing v0.4.0 schema additions — all additive/idempotent.

-- Milestone step overrides. Absent row = use the factory default from
-- src/coins.js. A present row with disabled=true turns milestones off for
-- that coin regardless of the factory default. A present row with a
-- step_value overrides the step size. See src/db/milestones.js.
CREATE TABLE IF NOT EXISTS milestone_overrides (
  symbol     TEXT PRIMARY KEY,
  step_value NUMERIC,
  disabled   BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-coin cooldown override in minutes. Absent = use COOLDOWN_MINUTES.
CREATE TABLE IF NOT EXISTS cooldown_overrides (
  symbol           TEXT PRIMARY KEY,
  cooldown_minutes INT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-alert-type default channel — overrides the single channels.is_default
-- channel for just that alert type (e.g. milestones to one channel,
-- everything else to another). Absent = fall back to the overall default.
CREATE TABLE IF NOT EXISTS default_channels_by_type (
  alert_type   TEXT PRIMARY KEY,
  channel_name TEXT NOT NULL REFERENCES channels(name) ON DELETE CASCADE
);

-- Digest is now schedule-table-driven (supports weekly/hourly cadences,
-- not just the old fixed daily-at-DIGEST_HOUR_UTC loop) — allow it as a
-- schedule kind. Digest schedules use symbol='ALL' (no single coin).
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_check CHECK (kind IN ('post', 'chart', 'digest'));

-- Optional minimum-move-% condition on a rule's trigger. Only meaningful
-- for threshold triggers (milestone/any_alert have no % move to compare);
-- NULL means "no minimum, fire on any qualifying alert."
ALTER TABLE rules ADD COLUMN IF NOT EXISTS min_move_pct NUMERIC;
