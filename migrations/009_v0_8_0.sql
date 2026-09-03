-- PricePing v0.8.0 schema additions — all additive/idempotent.

-- Caches each tracked coin's resolved CoinGecko id + market cap rank, so
-- "Top 20 by market cap" and category auto-tagging don't need to re-hit
-- CoinGecko's /search endpoint (rate-limited, ~30 req/min on the free
-- tier) on every button tap. Refreshed whenever a coin is auto-tagged
-- (see src/services/categorize.js) — symbol only, works for both built-in
-- and custom coins, same as coin_tags.
CREATE TABLE IF NOT EXISTS coin_meta (
  symbol            TEXT PRIMARY KEY,
  coingecko_id      TEXT,
  market_cap_rank   INT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
