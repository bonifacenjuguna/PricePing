# Changelog

## v0.6.1
- **Swapped CoinGecko ahead of Binance as the primary source for live price and candles**, per explicit request, as a temporary de-risking move — Binance/Kraken are still fully wired as fallback (not removed), so this is easy to flip back.
- Added `fetchOhlc()` to the CoinGecko adapter for candle data.
- Known tradeoffs, flagged directly in code comments so they don't get forgotten: CoinGecko's OHLC endpoint auto-picks granularity by day-range rather than letting us choose (no true 1-minute candles — a "1h" chart will effectively fall back to Binance in practice, since CoinGecko can't serve that resolution), and its free-tier rate limit (~10-30 calls/min) is much tighter than Binance's, so this path is more exposed to throttling under heavier load.
- Verified all 22 coins have a `geckoId` (required for this to work for every asset) and ran a full boot-sequence smoke test after the change — no regressions.

## v0.6.0
- **Found and fixed the actual root cause of the "tofu box" text bug** (every price/label/axis-label showing as empty character boxes on real Railway deploys). Confirmed via web search against the actual rsms/inter GitHub repo: the `docs/font-files/` path we were downloading `Inter-Regular.ttf`/`Inter-Bold.ttf` from only contains `.woff2` files there — every download 404'd, silently failed (by design, to avoid crashing card rendering), and the fonts table stayed permanently empty. That alone would just mean "no Inter, falls back to a system font" — except Railway's minimal Nixpacks Node image ships with **zero fonts installed at all**, so there was no fallback to fall back to. librsvg (which `sharp` uses to rasterize our SVG cards/charts) renders nothing for a glyph it can't resolve through fontconfig — not a substitute typeface, an empty box. Both screenshots the user sent match this exactly: shapes/colors/candles all rendered fine (confirms the earlier filter fix held), every single character was tofu.
- **New fix, verified against Nixpacks' own documented config syntax and the real nixpkgs package tree** (not guessed): added `nixpacks.toml` installing the `inter` and `dejavu_fonts` Nix packages at the OS level during Railway's build. This makes a real font available to fontconfig/librsvg unconditionally — no network download, no Postgres blob, no path that can silently 404 again. `"..."` in the `nixPkgs` array is Nixpacks' own extend-don't-replace syntax, confirmed against their config reference docs, so Node/npm auto-detection is untouched.
- Updated every `font-family` in `cardRenderer.js`/`chartRenderer.js` to `Inter, 'DejaVu Sans', sans-serif` — Inter as first choice (present via nixpacks now), DejaVu as an explicit, guaranteed-present second choice, instead of a bare `sans-serif` generic that has nothing to resolve to on a fontless container.
- Retired the old runtime font-download pipeline (`prepareFonts()` in `scripts/prepare-assets.js` is now a documented no-op; `fontSync.js` trimmed to a harmless bonus-layer check) rather than patching yet another external URL — the previous incident is exactly the failure mode of depending on an unversioned GitHub raw path for something rendering depends on; the OS-level Nix package is the more durable fix.
- Honest limitation: this sandbox has no way to actually run a Nixpacks build, so the `nixpacks.toml` syntax is verified against Nixpacks' documentation and real nixpkgs package names, not against a live build. Everything else (card/chart rendering logic, no regressions) was verified by actually rendering PNGs. Please confirm the next live Railway deploy actually shows readable text — if it doesn't, send another screenshot and the build log around the "setup" phase.
- Clarified for the user: the chart in their screenshot rendered coherent OHLC candle data, which means the Binance→Kraken fallback chain was already working correctly — the "via [source]" attribution label was just as unreadable as everything else due to the same font bug, not a separate fallback failure.

## v0.5.0
- **Added channel management, the missing piece behind both earlier reports**: there was no way to add the bot to a channel, so the channel list was always empty, so "Post to Channel" and every alert screen had nothing to work with. New `src/handlers/manageChannels.js` (Settings -> Manage Channels) uses Telegram's native `startchannel` deep link (`t.me/<bot>?startchannel=addchannel&admin=post_messages+edit_messages`) — tap it, Telegram opens its own chat picker with the two admin permissions we actually need preselected (least-privilege: just post_messages + edit_messages, nothing else requested), confirm, done. Registration into the channels table still happens automatically via the existing `my_chat_member` handler once promoted.
- Bot's own username is now resolved once at boot via `bot.telegram.getMe()` (`src/lib/botInfo.js`) so the deep link can be built; boot doesn't fail if this is briefly unavailable — the button just falls back to a plain-text instruction until it resolves.
- **Added a card preview**: a new "Get Price Card" button on every coin's panel renders the current card and sends it straight to the user's own DM — no channel required. Solves "I don't see any place for the cards" directly: you can now see exactly what a card looks like before ever setting up a channel.
- Fixed every "no channels yet" dead-end message across `manualPost.js` and `channelSettings.js` to link straight to the new Manage Channels screen instead of just describing the fix in prose.
- Fixed a real crash bug caught while building the preview button: `cardRenderer`'s badge logic would throw on `undefined.toFixed()` for any card rendered with no direction/changePct (which both the manual-post and preview-card paths do intentionally, since there's no threshold context for either) — tested the exact code path before considering it done, not just reasoned about it.
- Settings' old "Alert Delivery" shortcut (previously pointed at a hardcoded, usually-nonexistent channel id 0) replaced by "Manage Channels", which lists real registered channels and routes into the existing digest/quiet-hours screen per real channel id.

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
