# PricePing

Telegram bot (`@PricePingAlertsBot`) that posts real-time crypto price alerts
to Telegram channels, plus a fully button-driven private admin panel for
managing it. Currently at **v0.3.0**.

## Coins tracked

BTC, ETH, USDT, XRP, BNB, USDC, SOL, TRX, DOGE, XAUT out of the box — see
`src/coins.js` for brand colors, Binance pairs, and default thresholds.
More can be added at runtime with `/addcoin`, no redeploy needed.

## Start here: `/commands`

Every feature below is reachable by button — `/commands` (or `/start` →
"☰ All commands") opens a full control panel: Post & Chart, Thresholds,
Mute, Pause/Resume, Automation, Channels, Captions, Test, Stats, Settings.
The persistent bottom keyboard (Home / Prices / Thresholds / Stats) covers
the four most-used screens directly. A handful of things genuinely need
free text (a hex color, a chat ID, a caption template, a schedule's exact
time) — for those, tapping "+ Add" prompts you for one line of text with
the exact format shown, then executes immediately. Every button-driven
action also has a slash-command equivalent — see `/help` for the full list.

## What's new in v0.3.0

- **Customizable captions** — every caption (threshold alert, milestone
  alert, manual post, chart) is now a template you control, not a fixed
  string. `/setcaption TYPE <template>` (or Captions → pick a type → Edit
  in `/commands`), `/previewcaption TYPE` renders it against sample data
  before it goes live, `/resetcaption TYPE` reverts to the built-in
  default. A template line referencing a variable that doesn't apply to
  that alert (e.g. `{change_pct}` on a milestone alert) is dropped
  automatically — no conditional syntax to learn.
- **A lot more variables** — `/variables` lists everything available,
  grouped by which alert types populate them: `{symbol} {name} {price}
  {time} {date} {coin_rank} {channel_name} {channel_handle} {bot_name}
  {direction_arrow} {change_pct} {change_usd} {threshold_value}
  {threshold_type} {cooldown_remaining} {milestone_level} {next_milestone}
  {high_24h} {low_24h} {open_24h} {volume_24h} {change_since_last_post}
  {period_label} {alert_count_today}`. Define your own with `/setvar name
  value`, then use `{name}` anywhere.
- **Named channel registry** — replaces the old single "secondary channel"
  mirror. `/addchannel name chat_id`, `/removechannel name`,
  `/setdefaultchannel name`, `/channels` to list. Every post-capable
  command/button now targets one channel by name (defaulting to whichever
  is marked default) instead of broadcasting everywhere at once. A prior
  install's old secondary-channel setting is auto-imported as a channel
  named `secondary` the first time `npm run migrate` runs against it.
- **Automation** — recurring posts/charts (`/schedule`, e.g. a daily 9am
  BTC chart to a specific channel) and trigger→action rules (`/addrule`,
  e.g. "on any BTC milestone, also mirror to the VIP channel" or "on any
  threshold alert, broadcast a custom message to the news channel").
  `/schedules` and `/rules` list what's active with per-row remove buttons.
- **Advanced `/test`** — pick a coin, then an alert type (threshold /
  milestone / manual / chart), then (for threshold/milestone) a move size
  preset, then a destination — a real channel, or "preview to me only"
  which never touches the real channel. "⚡ Run full pipeline check" fires
  one of every alert type as a preview and reports pass/fail per step.
  `/test fail binance` and `/test fail telegram` exercise the *real*
  failure-handling code paths (an invalid Binance symbol, an invalid
  Telegram chat ID) so the admin-notification behavior can be verified
  without waiting for an actual outage.
- **`/start` is first** in the Telegram "/" command popup, as it should be.
- **`/commands`** — the shortcut hub described above.

## Card & caption design

- **Font**: cards render in Poppins (Bold for name/price/badge, Regular for
  the symbol subtitle), bundled as `.ttf` files in `src/assets/fonts/` and
  embedded directly into the SVG via `@font-face` (shared by the card and
  chart renderers — see `src/utils/fonts.js`), so rendering never depends
  on whatever fonts happen to be installed on the Railway image. Poppins is
  SIL Open Font License 1.1 (`src/assets/fonts/OFL.txt`).
- **Card visuals stay fixed** — the image layout (logo circle, price,
  badge position) is not templated, only the *caption text* sent alongside
  it is. A milestone alert's card shows a `▲ $110,000` badge; a threshold
  alert's shows `▲ 0.47%`; both are still governed by the underlying alert
  data, just no longer forced into one hardcoded sentence.
- **Command menu**: a curated subset of the most-used commands is
  registered with Telegram via `setMyCommands` on every boot for the "/"
  popup in your **private chat** with the bot, `/start` first — every
  command is usable even if it's not in that popup, see `/help`.

## One-time setup

```bash
npm install
cp .env.example .env   # fill in BOT_TOKEN, ADMIN_TELEGRAM_ID, CHANNEL_ID, DATABASE_URL, REDIS_URL

npm run migrate          # applies migrations/*.sql in order, seeds defaults + the "main" channel
npm run prepare-assets   # downloads coin logos into src/assets/logos/ (needs internet)
npm start
```

`prepare-assets` is the **only** step that needs internet access at setup
time (coins added later via `/addcoin` fetch their own logo at runtime,
same fallback behavior). If a logo download fails for any reason, it
automatically falls back to a plain monogram logo in that coin's brand
color so the bot still runs correctly — re-run the script later to swap in
the real logo once you have a working connection.

**Deploying straight to Railway without running this locally first:**
`railway.json` already handles both one-time steps: `build.buildCommand`
runs `npm run prepare-assets` during Railway's build step (which has
internet access), and `deploy.startCommand` runs `npm run migrate` every
time the container boots, before `npm start`. `scripts/migrate.js` applies
every file under `migrations/` in filename order and is safe to re-run on
every boot (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` throughout, plus a
default "main" channel seeded from `CHANNEL_ID`), so this needs no manual
step on your end — just set the env vars and deploy.

## Architecture

Single Node process, no separate worker — a self-scheduling tick loop
(`src/services/scheduler.js`) polls Binance every `POLL_INTERVAL_MS`
(default 30s) alongside the Telegraf bot's webhook handler. The next tick
is only scheduled after the current one fully finishes, so ticks never
overlap. Three independent 5-minute interval checks run alongside it:
`heartbeatWatchdog.js`, `digest.js` (fires once per UTC day at
`DIGEST_HOUR_UTC`), and `automationScheduler.js` (checks `schedules` for
anything due).

- **Postgres** — thresholds (with type), per-coin last-alerted price and
  mute state, alert history/stats (now with which channel each alert went
  to), settings, event log, heartbeat, runtime-added coins, the channel
  registry, caption templates, custom variables, schedules, and
  automation rules. Always read fresh each tick, never cached in memory
  across ticks — `config.coins` is the one exception, mutated in place at
  boot/on `/addcoin` so every module holding a reference sees new coins
  without a redeploy.
- **Redis** — reserved for ephemeral state (nothing currently *requires*
  it, but the client is wired up and ready as the admin panel grows).
- **Binance** — free public REST API, no API key: `/api/v3/ticker/price`
  (batched, every tick), `/api/v3/ticker/24hr` (digest, manual posts —
  now also parses `openPrice`/`quoteVolume` for `{open_24h}`/
  `{volume_24h}`), `/api/v3/klines` (charts, sparklines).

### A note on USDT specifically

Binance's spot market has no direct `USDT/USD` ticker — USDT is the quote
currency for almost every other pair. This bot approximates USDT's price
as the mathematical inverse of `USDCUSDT` (since USDC trades close to
$1), and derives its 24hr stats/klines the same way. It's a reasonable
peg-health proxy, not a true independent price feed — see
`src/services/marketData.js`. `{volume_24h}` is unavailable for USDT
specifically (not derivable from an inverted synthetic pair) and simply
won't render (the line drops).

### Alert behavior

- Threshold = absolute USD move OR percentage move since the *last alert*
  for that coin — not 24h change. Adjustable via `/setthreshold` or the
  +/− buttons under Thresholds in `/commands`.
- 5-minute cooldown per coin after a threshold alert (`COOLDOWN_MINUTES`).
- Milestone alerts (round-number crossings) are independent of the
  cooldown — their natural throttle is that price has to move a full step
  to re-trigger.
- A rolling hourly cap (`MAX_ALERTS_PER_HOUR`, default 20) trims how many
  alerts send in any given tick; held-back alerts wait for room next tick.
- Automatic threshold/milestone alerts always go to whichever channel is
  marked default (`/setdefaultchannel`). Rules (`/addrule`) are how you
  get an alert to *also* reach another channel, post a chart, or trigger a
  broadcast — deliberately opt-in per trigger, not blanket mirroring.
- Muted coins (`/mute`) skip both threshold and milestone alerts, but
  their price still updates in `/prices`.
- Stablecoins show price-only (no % badge, no milestones); everything
  else shows the ▲/▼ + % badge.
- On a Telegram send failure: one retry, then log and move on. On a
  Binance fetch failure: skip the tick, retry next cycle; admin gets
  notified after `BINANCE_FAILURE_ALERT_THRESHOLD` (default 10)
  consecutive failures.

### Memory & heartbeat watchdogs

`memoryWatchdog.js` checks heap usage every minute; once it crosses
`MEMORY_WARN_RATIO` (default 80%) of `MEMORY_LIMIT_MB` (default 220MB,
Railway's free tier caps at 512MB), it DMs the admin and exits cleanly so
Railway's restart policy brings it back fresh. `heartbeatWatchdog.js`
catches the separate case where the *process* is alive and memory-healthy
but the poll *loop* has silently stopped — it checks the `heartbeat` table
`poller.js` touches every tick; if that's stale beyond
`POLL_INTERVAL_MS × HEARTBEAT_STALE_MULTIPLIER` (default 3x), it DMs the
admin once.

## Admin bot — full command list

`/commands` for the button panel, or type any of these directly. Full
descriptions in `/help`.

| Area | Commands |
|---|---|
| Navigation | `/start` `/commands` `/status` `/help` `/whoami` |
| Prices & posting | `/prices` `/post SYMBOL [channel]` `/chart SYMBOL [period]` `/postchart SYMBOL [period] [channel]` |
| Thresholds | `/thresholds` `/setthreshold SYMBOL AMOUNT [pct]` |
| Pause / mute | `/pause [duration]` `/resume` `/mute SYMBOL [duration]` `/unmute SYMBOL` |
| Coins | `/addcoin SYMBOL PAIR #COLOR [Name]` `/history SYMBOL` |
| Channels | `/channels` `/addchannel name chat_id` `/removechannel name` `/setdefaultchannel name` |
| Captions | `/setcaption TYPE <template>` `/previewcaption TYPE` `/resetcaption TYPE` `/variables` `/setvar name value` `/delvar name` |
| Automation | `/schedule <line>` `/schedules` `/addrule <line>` `/rules` |
| Broadcast | `/broadcast CHANNEL message text` |
| Stats | `/stats` `/digestnow` |
| Testing | `/test [SYMBOL]` `/test fail binance` `/test fail telegram` |

## Testing without internet

Every piece that doesn't need a live network call was exercised against
mock data before delivery, escalated for v0.3.0 given the amount of new
interconnected logic:

- Every module in the entire dependency graph was `require()`'d against
  stub `pg`/`ioredis`/`telegraf`/`express`/`sharp` packages to catch
  wiring errors that `node --check` syntax validation alone can't catch.
- **`bot.js` was actually booted** (not just required) against the stubs
  with a timeout, exercising the real startup sequence end to end: coin
  registry load, boot-time default-channel check, startup self-test
  render, webhook/long-poll fallback, HTTP server, command registration,
  one-time announcement, every watchdog/scheduler `init()`, and a clean
  `SIGTERM` shutdown — with a real poller tick firing partway through and
  correctly detecting (and logging, not crashing on) the stub DB's empty
  channel table.
- The **template engine** was tested directly: variable substitution,
  the line-drop behavior for inapplicable variables (stablecoins,
  non-milestone alerts), unknown-variable typo visibility, and full
  `renderCaption()` output for all four alert types compared against the
  intended default wording.
- The **automation scheduler's due-check logic** was tested against
  synthetic timestamps across hourly/daily/weekly cadences, including
  exact boundary minutes, the 5-minute check-window bucketing, midnight
  UTC, and same-day dedupe (a schedule already run today must not re-fire).
- The **rules engine's trigger-matching logic** was tested against a
  fixture set of rules (symbol-specific, type-specific, and catch-all)
  to confirm each alert type/symbol combination matches exactly the rules
  it should and no others.
- The **schedule/rule guided-input line parsers** were tested against
  every documented example format plus malformed input (bad period, bad
  time format, missing broadcast message) to confirm both the happy path
  and the error messages are correct.
- SVG card rendering and every new/updated menu screen (channel list,
  schedule list, rule list, caption detail, variables help) were rendered
  against realistic data, including empty-list states, to confirm no
  screen throws on missing data.
- Every generated Telegram inline keyboard's `callback_data` length was
  checked against Telegram's 64-byte limit, including worst-case chains
  (longest symbol + longest alert type + longest channel name);
  everything measured comes in well under the limit (worst case 50 bytes).

The only things that couldn't be verified here are the real Binance/
Telegram endpoint responses at runtime and the actual `npm install` /
Railway deploy — both use long-stable, well-documented interfaces, so
they're written defensively but not something reachable from this
environment.
