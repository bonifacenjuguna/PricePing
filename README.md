# PricePing

Telegram bot (`@PricePingAlertsBot`) that posts real-time crypto price alerts
to the `@PricePing` channel, plus a private admin menu for managing it.

## Coins tracked

BTC, ETH, USDT, XRP, BNB, USDC, SOL, TRX, DOGE, XAUT — see `src/config.js`
for brand colors, Binance pairs, and default thresholds.

## Card & caption design (v0.1.3)

- **Font**: cards render in Poppins (Bold for name/price/badge, Regular for
  the symbol subtitle), bundled as `.ttf` files in `src/assets/fonts/` and
  embedded directly into the SVG via `@font-face` — this is deliberate:
  rendering never depends on whatever fonts happen to be installed on the
  Railway image. Poppins is SIL Open Font License 1.1
  (`src/assets/fonts/OFL.txt`), free to bundle and redistribute.
- **Logo & name**: the logo circle and coin name/symbol are sized up
  (~35% larger than the original design) for better legibility at
  Telegram's in-feed thumbnail size.
- **Caption**: two lines — `**Name** (SYMBOL) — $price ▲pct%` (arrow/%
  omitted for USDT/USDC), then `@PricePing` as its own watermark line.
  Sent with `parse_mode: 'HTML'` so the bold name renders correctly.

## One-time setup

```bash
npm install
cp .env.example .env   # fill in BOT_TOKEN, ADMIN_TELEGRAM_ID, CHANNEL_ID, DATABASE_URL, REDIS_URL

npm run migrate          # creates tables, seeds default thresholds
npm run prepare-assets   # downloads coin logos into src/assets/logos/ (needs internet)
npm start
```

`prepare-assets` is the **only** step that needs internet access. If a logo
download fails for any reason (offline, source moved, symbol not in the
icon set), it automatically falls back to a plain monogram logo in that
coin's brand color so the bot still runs correctly — re-run the script
later to swap in the real logo once you have a working connection.

**Deploying straight to Railway without running this locally first:**
`railway.json` already handles both one-time steps automatically:
`build.buildCommand` runs `npm run prepare-assets` during Railway's build
step (which has internet access), and `deploy.startCommand` runs
`npm run migrate` every time the container boots, before `npm start`.
Migrations are safe to re-run on every boot (`CREATE TABLE IF NOT EXISTS`
/ `ON CONFLICT DO NOTHING` throughout), so this needs no manual step on
your end — just set the env vars and deploy. If you'd rather only fetch
logos once and keep them fixed across deploys, run
`npm run prepare-assets` locally, commit the resulting `src/assets/logos/`
folder to your repo, and remove `prepare-assets` from `buildCommand`.

## Architecture

Single Node process, no separate worker — a self-scheduling tick loop
(`src/services/scheduler.js`) polls Binance every `POLL_INTERVAL_MS`
(default 30s) alongside the Telegraf bot's webhook handler. The next tick
is only scheduled after the current one fully finishes, so ticks never
overlap.

- **Postgres** — thresholds, per-coin last-alerted price (the source of
  truth for restart-safety), alert history/stats, settings, event log.
  Always read fresh each tick, never cached in memory across ticks.
- **Redis** — reserved for ephemeral state (nothing currently *requires*
  it, but the client is wired up and ready for session/cache use as the
  admin menu grows).
- **Binance** — free public REST API (`/api/v3/ticker/price`), one batched
  call per tick for all pairs. No API key, no attribution anywhere in bot
  output.

### A note on USDT specifically

Binance's spot market has no direct `USDT/USD` ticker — USDT is the quote
currency for almost every other pair, so it has no independent USD price
of its own on Binance. This bot approximates USDT's price as the
mathematical inverse of `USDCUSDT` (since USDC trades close to $1). It's a
reasonable peg-health proxy, not a true independent price feed — see the
comment in `src/config.js` and `src/services/marketData.js`.

### Alert behavior

- Threshold = absolute USD move since the *last alert* for that coin (not
  24h change).
- 5-minute cooldown per coin after an alert fires, even if price keeps
  moving past threshold.
- First tick ever for a coin seeds a silent baseline — no alert fires
  until the second comparison has something real to compare against.
- USDT/USDC show price-only in the channel (no % badge); everything else
  shows the ▲/▼ + % badge.
- On a Telegram send failure: one retry, then log and move on — a single
  failed send never blocks the rest of the tick.
- On a Binance fetch failure: skip the tick, retry next cycle; only
  notifies the admin after `BINANCE_FAILURE_ALERT_THRESHOLD` (default 10)
  consecutive failures.

### Memory watchdog

Railway's free tier caps at 512MB. `src/services/memoryWatchdog.js` checks
heap usage every minute; once it crosses `MEMORY_WARN_RATIO` (default 80%)
of `MEMORY_LIMIT_MB` (default 220MB), it DMs the admin and exits cleanly so
Railway's restart policy brings it back fresh — safer than waiting for an
uncontrolled OOM crash mid-send.

## Admin bot

Only `ADMIN_TELEGRAM_ID` can talk to the bot — everyone else gets a
one-line "this bot is private" reply. Navigate via the persistent bottom
keyboard (Home / Prices / Thresholds / Stats) or type commands directly:

| Command | Does |
|---|---|
| `/status` | uptime, running/paused state, alerts today |
| `/prices` | current price for every tracked coin |
| `/thresholds` | view all thresholds |
| `/setthreshold SYMBOL AMOUNT` | change one, e.g. `/setthreshold BTC 400` |
| `/pause` / `/resume` | stop/start posting to the channel |
| `/test [SYMBOL]` | send a sample alert card to the channel |

## Testing without internet

Every piece that doesn't need a live network call was exercised against
mock data before delivery: the SVG→PNG card renderer (with and without a
local logo file present), the threshold/cooldown decision logic, the
USDT-inverse price derivation, caption formatting, and the malformed/
missing-data handling paths in the Binance response parser. The only
things that couldn't be verified here are the real Binance endpoint
response at runtime and the actual npm install / Railway deploy — both
use long-stable, well-documented interfaces (Binance's `ticker/price`
endpoint, Railway's Nixpacks build), so they're written defensively but
not something I could hit directly from this environment.
