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
