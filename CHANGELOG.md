# Changelog

## v0.4.0
- **Fixed the root cause of blank cards/charts**: every card and chart used SVG `feDropShadow`/`feGaussianBlur` filters for shadows and glow. Per the SVG spec, an element referencing an unsupported filter doesn't render without the effect — it doesn't render at all. librsvg's `feDropShadow` support is inconsistent across versions, and Railway's container hit that gap, so nearly every visible element (price text, logo circle, badges, chart line) silently vanished, leaving background-only images. Rewrote every shadow/glow in `cardRenderer.js` and `chartRenderer.js` to use plain duplicated/offset shapes instead of filter primitives — guaranteed to render on any SVG engine. Verified by actually rendering real PNGs with the real `sharp` package and visually inspecting them (compact card, loose card, line chart, candlestick chart all confirmed showing full content).
- Also removed the 🎉 emoji from the SVG-drawn milestone badge (found during the same visual check — it rendered as a broken glyph box since color-emoji fonts aren't installed on the render container); the celebratory emoji still appears in the Telegram message caption, which Telegram renders natively.
- **Added manual posting** (`src/handlers/manualPost.js`): Settings -> Post to Channel, or a "Post This to a Channel" shortcut from any coin's panel. Picks a channel, picks a coin, shows a confirmation preview with the live price before posting (same confirm-before-firing pattern as bulk actions), then posts immediately — bypasses threshold/milestone logic entirely. Fixes a real gap: there was previously no way to verify posting worked, or to post on demand, without waiting for a real market move to trigger an alert.
- Clarified (not a bug, but worth documenting): a channel's first price tick for any coin silently seeds a baseline with no alert, by design, to avoid spamming on setup — expect no alerts until a real threshold/milestone crossing happens after that baseline is set. Manual posting above is the way to confirm things are working without waiting for that.

## v0.3.1
- Fixed a build-crashing bug in `scripts/prepare-assets.js`: the build-time Postgres pool had no `.on('error', ...)` handler and no connection timeout, so when `DATABASE_URL` wasn't network-reachable during Railway's build step (common — the Postgres plugin isn't always wired to the build container the same way it is at runtime), the pool's background error event went unhandled and crashed the entire build, not just the asset step. Fixed by adding `connectionTimeoutMillis: 5000`, an error handler that logs instead of crashing, and wrapping the table-creation queries in try/catch so a failed DB connection falls through to local-file-only asset prep (skips the Postgres blob upload, keeps everything else working) instead of aborting the deploy. Confirmed working on a live Railway deploy.

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
