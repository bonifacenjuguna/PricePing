# PricePing

Telegram bot (`@PricePingAlertsBot`) that posts real-time crypto price alerts
to the `@PricePing` channel, plus a private admin menu for managing it.

## Coins tracked

BTC, ETH, USDT, XRP, BNB, USDC, SOL, TRX, DOGE, XAUT out of the box — see
`src/coins.js` for brand colors, Binance pairs, and default thresholds.
More can be added at runtime with `/addcoin` (v0.2.0) without a redeploy.

## What's new in v0.2.0

- **Manual posts** — type a bare symbol (e.g. `BTC`) in the private chat, or
  `/post BTC`, to post a price update to the channel on demand. Uses a
  richer card than automatic alerts: 24h high/low, 24h % change, and a
  small embedded sparkline.
- **Charts** — `/chart SYMBOL [1h|24h|7d|30d]` sends you a price chart
  privately; `/postchart SYMBOL [period]` posts one to the channel.
- **Percentage-based thresholds** — `/setthreshold BTC 2 pct` alerts on a
  2% move instead of a flat dollar amount. Existing `$` thresholds are
  unaffected.
- **Runtime coin adding** — `/addcoin SYMBOL PAIR #COLOR [Name]` tracks a
  new coin immediately, no redeploy needed. Fetches a logo the same way
  `prepare-assets` does at build time (falls back to a plain monogram if
  offline or not found).
- **Per-coin mute** — `/mute SYMBOL [duration]` / `/unmute SYMBOL`, separate
  from the global `/pause`.
- **Pause/mute with a duration** — `/pause 2h` and `/mute BTC 30m` auto-
  resume; bare `/pause` is still indefinite until `/resume`.
- **Hourly alert cap** — `MAX_ALERTS_PER_HOUR` (default 20) caps channel
  sends in any trailing 60 minutes, so a flash-crash can't spam the channel
  every cooldown window for hours straight.
- **Milestone alerts** — round-number crossings (e.g. BTC every $10,000,
  see `milestoneStep` in `src/coins.js`) fire as their own alert type,
  independent of the threshold/cooldown system.
- **Daily digest** — one summary post at `DIGEST_HOUR_UTC` (default 9am
  UTC) with every coin's price + 24h change, plus a "biggest mover"
  callout. `/digestnow` sends one immediately for testing.
- **Second channel mirroring** — `/setsecondary CHANNEL_ID` mirrors every
  post (alerts, manual posts, charts) to a second channel too.
- **`/history SYMBOL`** — recent alert activity for one coin.
- **Undo on `/setthreshold`** — an inline "Undo" button reverts to the
  previous value.
- **Heartbeat / dead-man's switch** — the poller timestamps every
  completed tick; if that goes stale while the process is still alive
  (stuck loop, not a crash), `heartbeatWatchdog.js` DMs the admin instead
  of alerts just silently stopping.
- **Startup self-test** — renders one card fully in memory at boot (never
  sent anywhere) to catch a broken font/image pipeline immediately, not at
  the first real alert.
- **`/whoami`** — quick sanity check of admin ID / chat ID / bot version.
- **Fixed**: the access gate no longer replies "this bot is private" into
  the channel itself. It was scoped to *every* update rather than private
  chats only, so `channel_post` updates (delivered because the bot is a
  channel admin) were tripping the same "unauthorized sender" reply path
  and landing back in the channel. Now scoped to `ctx.chat.type === 'private'`.

## Card & caption design

- **Font**: cards render in Poppins (Bold for name/price/badge, Regular for
  the symbol subtitle), bundled as `.ttf` files in `src/assets/fonts/` and
  embedded directly into the SVG via `@font-face` (shared by both card
  renderer and chart renderer — see `src/utils/fonts.js`) — this is
  deliberate: rendering never depends on whatever fonts happen to be
  installed on the Railway image. Poppins is SIL Open Font License 1.1
  (`src/assets/fonts/OFL.txt`), free to bundle and redistribute.
- **Logo & name**: the logo circle and coin name/symbol are sized up for
  legibility at Telegram's in-feed thumbnail size. The logo image fills
  most of the white circle, leaving a thin ring visible.
- **Automatic alert caption**: three rows — `<b>Name</b> (SYMBOL) —
  $price`, then `▲ pct%` (omitted for stablecoins, and for milestone
  alerts which show `▲ Crossed $110,000` instead), then `@PricePing`.
- **Manual-post caption**: adds a `24h ▲ x.xx% · H $x · L $x` row.
- **Command menu**: a curated subset of the most-used commands is
  registered with Telegram via `setMyCommands` on every boot for the "/"
  suggestion popup in your **private chat** with the bot — every command
  is usable even if it's not in that popup list, see `/help` for the full
  set.

## One-time setup

```bash
npm install
cp .env.example .env   # fill in BOT_TOKEN, ADMIN_TELEGRAM_ID, CHANNEL_ID, DATABASE_URL, REDIS_URL

npm run migrate          # applies migrations/*.sql in order, seeds defaults
npm run prepare-assets   # downloads coin logos into src/assets/logos/ (needs internet)
npm start
```

`prepare-assets` is the **only** step that needs internet access at setup
time (coins added later via `/addcoin` fetch their own logo at runtime,
same fallback behavior). If a logo download fails for any reason (offline,
source moved, symbol not in the icon set), it automatically falls back to
a plain monogram logo in that coin's brand color so the bot still runs
correctly — re-run the script later to swap in the real logo once you have
a working connection.

**Deploying straight to Railway without running this locally first:**
`railway.json` already handles both one-time steps automatically:
`build.buildCommand` runs `npm run prepare-assets` during Railway's build
step (which has internet access), and `deploy.startCommand` runs
`npm run migrate` every time the container boots, before `npm start`.
`scripts/migrate.js` applies every file under `migrations/` in filename
order and is safe to re-run on every boot (`IF NOT EXISTS` /
`ON CONFLICT DO NOTHING` throughout), so this needs no manual step on your
end — just set the env vars and deploy.

## Architecture

Single Node process, no separate worker — a self-scheduling tick loop
(`src/services/scheduler.js`) polls Binance every `POLL_INTERVAL_MS`
(default 30s) alongside the Telegraf bot's webhook handler. The next tick
is only scheduled after the current one fully finishes, so ticks never
overlap. Two independent lightweight interval checks run alongside it:
`heartbeatWatchdog.js` (every `HEARTBEAT_CHECK_INTERVAL_MS`, default 5m)
and `digest.js` (every 5m, fires once per UTC day at `DIGEST_HOUR_UTC`).

- **Postgres** — thresholds (with type), per-coin last-alerted price and
  mute state, alert history/stats, settings, event log, heartbeat,
  runtime-added coins. Always read fresh each tick, never cached in
  memory across ticks — `config.coins` is the one exception, mutated in
  place at boot/on `/addcoin` so every module holding a reference sees new
  coins without a redeploy.
- **Redis** — reserved for ephemeral state (nothing currently *requires*
  it, but the client is wired up and ready for session/cache use as the
  admin menu grows).
- **Binance** — free public REST API, no API key: `/api/v3/ticker/price`
  (batched, every tick), `/api/v3/ticker/24hr` (digest, manual posts,
  milestone-adjacent context), `/api/v3/klines` (charts, sparklines). No
  attribution required anywhere in bot output.

### A note on USDT specifically

Binance's spot market has no direct `USDT/USD` ticker — USDT is the quote
currency for almost every other pair, so it has no independent USD price
of its own on Binance. This bot approximates USDT's price as the
mathematical inverse of `USDCUSDT` (since USDC trades close to $1), and
derives its 24hr stats/klines the same way. It's a reasonable peg-health
proxy, not a true independent price feed — see the comments in
`src/services/marketData.js`.

### Alert behavior

- Threshold = absolute USD move OR percentage move (your choice per coin,
  via `/setthreshold SYMBOL AMOUNT [pct]`) since the *last alert* for that
  coin — not 24h change.
- 5-minute cooldown per coin after a threshold alert fires (configurable:
  `COOLDOWN_MINUTES`), even if price keeps moving past threshold.
- Milestone alerts (round-number crossings) are independent of the
  cooldown — their natural throttle is that price has to move a full step
  to re-trigger.
- A rolling hourly cap (`MAX_ALERTS_PER_HOUR`, default 20) trims how many
  alerts get sent in any given tick if the channel's getting spammy; held-
  back alerts aren't lost, they just wait for room in the next tick.
- First tick ever for a coin (or a coin just added via `/addcoin`) seeds a
  silent baseline — no alert fires until the second comparison has
  something real to compare against.
- Muted coins (`/mute`) skip both threshold and milestone alerts, but
  their price still updates in `/prices`.
- Stablecoins show price-only in the channel (no % badge, no milestones);
  everything else shows the ▲/▼ + % badge.
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

### Heartbeat watchdog

Separate concern from the memory watchdog: catches the case where the
*process* is alive and memory-healthy but the poll *loop* has silently
stopped ticking (e.g. an unawaited rejection slipping past the scheduler's
try/catch in some future edit). `src/services/heartbeatWatchdog.js` checks
the `heartbeat` table `poller.js` touches every tick; if it's stale beyond
`POLL_INTERVAL_MS \u00D7 HEARTBEAT_STALE_MULTIPLIER` (default 3x), it DMs
the admin once (re-arms once a fresh tick comes through).

## Admin bot

Only `ADMIN_TELEGRAM_ID` can talk to the bot in a private chat — everyone
else gets a one-line "this bot is private" reply. Navigate via the
persistent bottom keyboard (Home / Prices / Thresholds / Stats) or type
commands directly. Full list via `/help` in the bot; highlights:

| Command | Does |
|---|---|
| `/status` | uptime, running/paused state, heartbeat, alerts today |
| `/prices` | current price for every tracked coin |
| `BTC` (bare symbol) or `/post BTC` | post a price update to the channel now |
| `/chart BTC 24h` | send yourself a price chart (1h / 24h / 7d / 30d) |
| `/postchart BTC 24h` | post a chart to the channel |
| `/thresholds` | view all thresholds and their types |
| `/setthreshold SYMBOL AMOUNT [pct]` | change one, e.g. `/setthreshold BTC 400` or `/setthreshold ETH 2 pct` |
| `/pause [DURATION]` / `/resume` | stop/start posting; `/pause 2h` auto-resumes |
| `/mute SYMBOL [DURATION]` / `/unmute SYMBOL` | silence one coin |
| `/addcoin SYMBOL PAIR #COLOR [Name]` | track a new coin at runtime |
| `/history SYMBOL` | recent alert activity for one coin |
| `/stats` | alert counts, today/all-time/per-coin |
| `/setsecondary CHANNEL_ID` / `/clearsecondary` | mirror posts to a 2nd channel |
| `/test [SYMBOL]` | send a sample alert card to the channel |
| `/whoami` | confirm admin ID / chat ID / bot version |

## Testing without internet

Every piece that doesn't need a live network call was exercised against
mock data before delivery, including for v0.2.0: every module was
require()'d against stub `pg`/`ioredis`/`telegraf`/`express`/`sharp`
packages to catch wiring errors (missing exports, bad destructuring) that
`node --check` syntax validation alone can't catch; the SVG generators
(alert card, milestone card, stablecoin card, rich manual-post card with
sparkline, full chart) were run against realistic data and checked for
correct structure; the threshold qualification logic was tested for both
`usd` and `pct` types in both directions; and the duration parser was
tested against valid and invalid input. The only things that couldn't be
verified here are the real Binance endpoint responses at runtime and the
actual `npm install` / Railway deploy — both use long-stable,
well-documented interfaces, so they're written defensively but not
something reachable from this environment.
