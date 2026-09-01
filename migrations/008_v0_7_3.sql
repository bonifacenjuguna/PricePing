-- PricePing v0.7.3 schema additions — all additive/idempotent.

-- Freeform coin tags/groups (e.g. "defi", "meme", "layer1") — keyed by
-- symbol only, so it works uniformly for both built-in coins (coins.js)
-- and custom ones added via /addcoin (custom_coins table), no foreign key
-- into either. Used by /movers and the bulk-action wizard to scope to a
-- subset of tracked coins instead of "all" or one-at-a-time.
CREATE TABLE IF NOT EXISTS coin_tags (
  symbol TEXT NOT NULL,
  tag    TEXT NOT NULL,
  PRIMARY KEY (symbol, tag)
);
