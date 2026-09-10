# Changelog

## v0.3.0
- Font pipeline added: Inter Regular/Bold downloaded at build time (rsms/inter GitHub source), stored as Postgres blobs, synced to local disk on boot — same resilience pattern as the logo pipeline (graceful fallback to system default font if unavailable)
- Digest-mode batching fully wired: threshold/milestone alerts on digest-enabled channels now queue in Redis and flush as one combined summary message on the channel's own interval, holding through quiet hours instead of dropping
- New Channel Alert Delivery screen (Settings -> Alert Delivery): toggle instant vs digest, pick digest interval (15/30/60/120m), pick quiet hours preset
- Watchlist filter fully implemented: Settings -> My Watchlist now shows only starred coins, with its own select-all/select-none/bulk-select scoped to the filtered list
- Chart coin-picker pagination implemented (was hardcoded to page 0)
- Rewrote the coin-list callback-data scheme so pagination, multi-select, and the watchlist filter all carry mode/filter/channelId consistently through every button — the previous version could lose context on some pagination paths
- Verified via a require-graph + full boot-sequence smoke test (stubbed external deps only, since this sandbox has no network access to the real npm registry or live APIs) — migrations, Redis connection, logo/font sync, 7-source self-check, HTTP server, bot launch, poller, digest scheduler, and clean SIGTERM shutdown all complete successfully end-to-end

## v0.2.0
Core backbone complete:
- 7-source market data layer (Binance, Kraken, CoinGecko, CoinPaprika, CoinLore, GeckoTerminal, Alternative.me) with fallback chains, rate-limit-aware rotation, stale-price guard, cross-source milestone sanity check, boot self-check
- 22-asset registry (20 coins + USDT + USDC) with per-coin defaults
- Postgres schema (users, channels, coin_settings, coin_state, alerts_log, logos, source_health) + migration runner
- Redis-backed session, cache, and rate-limit tracking
- Logo pipeline: CoinGecko download -> Postgres blob storage -> disk sync on boot (survives Railway's ephemeral filesystem)
- Card renderer (compact + loose modes) and chart renderer (line + candlestick), SVG -> sharp 3x-supersample pipeline
- Milestone + threshold alert engine (poller.js) with quiet hours, cooldowns, digest-mode fields
- Pure-Intl timezone system
- Real back-stack navigation (no dead ends), paginated coin list, multi-select bulk actions, sleek per-coin control panel
- Settings, status/health, Fear & Greed, chart request handlers
- Memory watchdog + clean shutdown with hard deadline + crash handlers
- Channel registration via my_chat_member (bot added as admin)

## v0.1.0
Initial scaffold — project structure, config, coin registry only.
