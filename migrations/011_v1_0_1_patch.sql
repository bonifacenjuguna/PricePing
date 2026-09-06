-- v1.0.1 patch: `templates` turned out not to exist on the live database
-- (confirmed by "relation \"templates\" does not exist" in production) —
-- these CREATE TABLE IF NOT EXISTS are a safety net for it and its close
-- siblings, plus the two tables the restored watchdogs need. All
-- idempotent; anything that already exists is left untouched.

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  name        TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS templates (
  key       TEXT PRIMARY KEY,
  template  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_vars (
  name   TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Append-only system/audit log, read by both watchdogs.
CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row table touched at the end of every successful poller tick —
-- watched by heartbeatWatchdog.js to catch a silently-stuck poll loop.
CREATE TABLE IF NOT EXISTS heartbeat (
  id            INTEGER PRIMARY KEY,
  last_tick_at  TIMESTAMPTZ,
  last_tick_ms  INTEGER
);
INSERT INTO heartbeat (id, last_tick_at, last_tick_ms)
VALUES (1, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
