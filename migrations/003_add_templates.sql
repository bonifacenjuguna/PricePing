-- Caption template system, ported from PricePing's templateEngine.js.
-- `templates`: key is either a bare alert type ('threshold', 'milestone',
-- 'manual', 'chart') for a type-wide override, or 'type:SYMBOL' (e.g.
-- 'threshold:BTC') for a per-coin override that takes precedence over the
-- type-wide one. Absence of a row means "use the built-in default" — see
-- src/lib/templateEngine.js's DEFAULT_TEMPLATES.
CREATE TABLE IF NOT EXISTS templates (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Custom variables an admin can define for use in templates (e.g.
-- {my_note}) — never allowed to shadow a built-in variable name; see
-- templateEngine.js's applyCustomVarsWithoutOverride.
CREATE TABLE IF NOT EXISTS custom_vars (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
