# PricePing v1.0.0

## What changed from v0.8.0

- **Binance auto-sync** replaces manual `/addcoin` — the bot polls Binance's
  free public `exchangeInfo` + `ticker/24hr` on a schedule (`BINANCE_SYNC_INTERVAL_MS`),
  tracks every `USDT`-quoted `TRADING` pair, and auto-onboards/removes coins
  as they list/delist. Each new coin gets its logo downloaded automatically
  (`services/binanceSync.js`, reusing the same `resolveLogoSvg` fallback
  logic as before) and a tier-based default threshold.
- **Tiers** — Major/Mid/Micro, assigned by 24h volume rank, each with its own
  default alert threshold %. Owner-editable per-tier or per-coin.
- **Bot Modes** — Nitro (¼x), Turbo (½x), Cruise (1x/normal), Anti-Spam (2x +
  daily post cap + no Movers automation). One dial scales both alert
  sensitivity and automation cadence.
- **Multi-channel** — one un-removable primary channel (`CHANNEL_ID`), plus
  owner-addable extra channels via the bot menu. Each channel can toggle
  individual post types off.
- **UI** — only `/start` is a registered command. Everything else is inline
  buttons + a small context-aware reply keyboard (see design notes below).
- **Timezone-aware digests** — daily/weekly digest timing computed against
  a configurable IANA timezone instead of a fixed UTC hour.
- **Startup announcement** — on boot, a detailed status DM goes to the
  owner, and a short silent heartbeat ("✅ PricePing is back online") goes
  to every bound channel.

## Deploying on top of your existing Railway project

1. Push this repo to the same GitHub repo Railway is already watching.
2. Add the new env vars listed in `.env.example` under "New in v1.0.0" —
   every existing var keeps its exact name, nothing to change there.
3. Redeploy. `npm run migrate` runs automatically (`Procfile`) and applies
   `migrations/010_v1_0_0.sql` — additive only, safe against your existing
   database.
4. On first boot, Binance sync runs immediately and populates the `coins`
   table + downloads logos — no manual seeding needed. You can also trigger
   this manually anytime via 📡 Watching → 🔄 Force Sync Now.

## Design notes (button color system)

- 🔴 Red — only an irreversible execute action (e.g. confirming a channel
  removal). Never appears next to another red button.
- 🟢 Green — only ever means "the safe way out" (Cancel).
- 🔵 Blue — navigation, and the confirm side of an already-safe action.
- No color — incidental (pagination, minor toggles).

Reply keyboard (BBTB) rows are shaped to whatever screen you're on — no
button whose destination is the screen you're already viewing.

## v1.0.1 patch notes

- **Fixed:** `/start`'s inline menu and the persistent BBTB row were being
  attached to the same message — Telegram only allows one `reply_markup`
  per message, so the reply keyboard silently overwrote the inline one.
  Now sent as two messages; BBTB text taps route through
  `utils/renderScreen.js` (edit if from an inline tap, fresh send if from
  a BBTB tap).
- **Fixed:** `templates` (and defensively `custom_vars`) didn't actually
  exist on the production database — added as an idempotent migration
  (`011_v1_0_1_patch.sql`).
- **Fixed:** memory footprint. `MAX_TRACKED_COINS` (default 50) caps the
  Binance-synced coin list to the most popular, most-volume coins —
  sized for Railway's Free plan 512MB hard ceiling. `MEMORY_LIMIT_MB`
  default raised to 420 to match that ceiling with headroom.
- **Restored & fixed:** the original bot's memory watchdog and heartbeat
  watchdog (`services/memoryWatchdog.js`, `heartbeatWatchdog.js`) — same
  graceful-restart-with-admin-DM design as before, but now measures `rss`
  instead of `heapUsed`. `sharp`'s image buffers live in native memory
  outside the V8 heap, so heapUsed alone was blind to the single biggest
  memory consumer in this bot.
- **Added:** `services/priceFallback.js` — CoinGecko, then Kraken, as an
  automatic fallback for your core coins (`CORE_COIN_SYMBOLS`) if Binance
  goes fully unreachable across every mirror. Recovers automatically —
  you get a DM both when it fails over and when Binance comes back.
- **Centralized:** every Binance API call (sync, poller, chart/klines) now
  goes through `services/binanceClient.js`'s shared mirror list, so an
  outage on one host doesn't leave some features recovered and others
  still dark.
