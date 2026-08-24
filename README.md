# PricePing

Telegram bot (`@PricePingAlertsBot`) that posts real-time crypto price alerts
to Telegram channels, plus a fully button-driven private admin panel for
managing it. Currently at **v0.4.0**.

## Coins tracked

BTC, ETH, USDT, XRP, BNB, USDC, SOL, TRX, DOGE, XAUT out of the box — see
`src/coins.js` for brand colors, Binance pairs, and default thresholds/
milestone steps. More can be added at runtime with `/addcoin`, no redeploy.

## Start here: `/commands`

Every feature is reachable by button — `/commands` (or `/start` → "☰ All
commands") opens the control panel: Post & Chart, Coin settings, Mute,
Pause/Resume, Automation, Channels, Captions, Test, Stats, Reset. The
persistent bottom keyboard covers the four most-used screens directly.
Screens reached from the hub have a "◀ Back" that returns one level, plus
Home — consistent everywhere as of v0.4.0. A few things genuinely need
free text (a hex color, a chat ID, a caption template, an exact schedule
time) — tapping "+ Add" prompts for one line in the exact format shown,
then executes on send; typing `/cancel` at that prompt backs out cleanly.

## What's new in v0.4.0

- **Milestone steps are now yours to set** — this is the "alert me every
  $500 as BTC crosses 71,500 / 72,000 / 72,500..." feature. `/setmilestone
  BTC 500` (or the ± buttons on the new unified coin settings screen).
  `/setmilestone SYMBOL off` disables it for one coin. `/milestones` shows
  every coin's current step. Previously this was a fixed value per coin in
  the source code; now it's live-editable and survives restarts.
- **`/reset`** — scoped resets back to factory defaults: thresholds,
  milestones, cooldowns, captions, custom variables, channels, or
  automation (schedules + rules) — individually or all at once
  (`/reset everything`). Every option requires a button-tap confirmation
  first; nothing resets from a slash command alone.
- **Unified coin settings screen** — one screen per coin (threshold,
  milestone step, cooldown override, mute) instead of hunting across
  three separate menus. Reached from Thresholds, Milestones, or the hub's
  "⚙ Coin settings."
- **Per-coin cooldown override** — `/setcooldown SYMBOL MINUTES` /
  `/resetcooldown SYMBOL`, or the ± buttons on the coin settings screen.
  Falls back to the global `COOLDOWN_MINUTES` when not set.
- **Per-coin caption overrides** — `/setcaption threshold:BTC <template>`
  makes BTC's threshold alerts look different from every other coin's,
  without touching the shared default. `/previewcaption`/`/resetcaption`
  accept the same `type:SYMBOL` form.
- **Digest is now a real schedule** — moved off its old fixed daily-only
  env-var loop and onto the same `schedules` table as everything else, so
  it supports hourly/weekly cadences too, shows up in `/schedules`, and is
  editable without a redeploy. A prior install's `DIGEST_HOUR_UTC` setting
  is auto-seeded as a daily schedule the first time `npm run migrate` runs.
- **Rule magnitude conditions** — `/addrule threshold post_chart main
  min:5 1h` only fires when the qualifying move is 5%+ (threshold alerts
  only; milestone/any_alert triggers have no % to compare against).
- **Multiple default channels by alert type** — `/setdefaultchannel name
  milestone` sends only milestone alerts to that channel, independent of
  the overall default; `/cleardefaultchannel milestone` removes the
  override. `/channels` shows both the overall default and any per-type
  overrides.
- **Schedule/rule editing** — "✏ Edit" on any row in `/schedules`/`/rules`
  re-prompts with the current line pre-shown so you can copy-edit-resend,
  instead of delete-then-recreate.
- **Confirm-before-create on `/addcoin`** — shows the parsed symbol/pair/
  color/name and waits for a button confirm, catching typos before a junk
  coin gets tracked.
- **`/history SYMBOL [channel]`** — filter alert history to one channel.
- **Recently-used coins** — the post/chart/mute/test coin-picker grids
  show a "🕐 recent" row on top once you've used a few, so common coins
  aren't buried as the list grows via `/addcoin`.
- **Test menu remembers your last destination** — the channel you last
  sent a test to is surfaced first in the picker.
- **`/exportconfig` / `/importconfig`** — dumps every setting (thresholds,
  milestones, cooldowns, channels, captions, variables, schedules, rules)
  as one downloadable JSON file; `/importconfig` then accepts that JSON
  pasted back as a message to restore it, reporting a per-section
  success/failure count. *(Import is paste-based, not file-upload-based —
  see the note under Testing below for why.)*

## Card & caption design

- **Font**: Poppins, embedded as base64 `@font-face` in every rendered SVG
  (`src/utils/fonts.js`) — never depends on fonts installed on the host.
- **Card visuals stay fixed** — layout isn't templated, only the caption
  text is. Per-symbol caption overrides change wording, not the image.
- **Command menu**: `/start` first in the "/" popup, curated subset —
  every command works even if not in that popup, see `/help`.

## One-time setup

```bash
npm install
cp .env.example .env   # fill in BOT_TOKEN, ADMIN_TELEGRAM_ID, CHANNEL_ID, DATABASE_URL, REDIS_URL

npm run migrate          # applies migrations/*.sql in order, seeds defaults + "main" channel
npm run prepare-assets   # downloads coin logos into src/assets/logos/ (needs internet)
npm start
```

`prepare-assets` is the only step needing internet at setup time (coins
added later via `/addcoin` fetch their own logo at runtime, same
monogram fallback if that fails). Railway deploys handle both steps
automatically via `railway.json` — see the comments in that file.

## Architecture

Single Node process — a self-scheduling tick loop (`src/services/
scheduler.js`) polls Binance every `POLL_INTERVAL_MS` (default 30s)
alongside Telegraf's webhook handler; the next tick only queues after the
current one finishes. Two independent 5-minute interval checks run
alongside it: `heartbeatWatchdog.js` and `automationScheduler.js` (checks
`schedules` for anything due — posts, charts, *and* digests as of v0.4.0).

- **Postgres** — thresholds, milestone overrides, cooldown overrides,
  per-coin mute state, alert history (with channel + type), settings,
  event log, heartbeat, runtime-added coins, the channel registry
  (including per-alert-type defaults), caption templates (global and
  per-symbol), custom variables, schedules, and rules. Always read fresh
  each tick — `config.coins` is the one in-memory exception, mutated in
  place at boot/`/addcoin`.
- **Binance** — free public REST, no key: `/ticker/price` (every tick),
  `/ticker/24hr` (digest, manual posts, `{volume_24h}`/`{open_24h}`),
  `/klines` (charts, sparklines).

### Alert behavior

- Threshold = absolute USD or % move since the coin's last alert.
  Adjustable via `/setthreshold` or ± buttons in coin settings.
- Cooldown = `COOLDOWN_MINUTES` by default, overridable per coin.
- **Milestones** = a fixed step size (yours to set via `/setmilestone`);
  every crossing in either direction fires, independent of cooldown — its
  own natural throttle is that price must move a full step to re-trigger.
- Automatic threshold/milestone alerts go to whichever channel is default
  for that specific type (`/setdefaultchannel name TYPE`), falling back to
  the overall default. Rules are how an alert *also* reaches another
  channel, posts a chart, or triggers a broadcast — opt-in, not automatic,
  and can be gated by move size (`min:PCT`).
- Hourly send cap (`MAX_ALERTS_PER_HOUR`) still applies across everything.

### Watchdogs

`memoryWatchdog.js` (heap vs `MEMORY_LIMIT_MB`) and `heartbeatWatchdog.js`
(a stuck-but-alive poll loop) — unchanged from v0.3.0, both DM the admin.

## Admin bot — command reference

`/commands` for buttons, or type directly — full descriptions in `/help`.

| Area | Commands |
|---|---|
| Navigation | `/start` `/commands` `/status` `/help` `/whoami` |
| Prices & posting | `/prices` `/post SYMBOL [channel]` `/chart SYMBOL [period]` `/postchart SYMBOL [period] [channel]` |
| Thresholds & milestones | `/thresholds` `/setthreshold SYMBOL AMOUNT [pct]` `/milestones` `/setmilestone SYMBOL STEP\|off` |
| Cooldown | `/setcooldown SYMBOL MINUTES` `/resetcooldown SYMBOL` |
| Pause / mute | `/pause [duration]` `/resume` `/mute SYMBOL [duration]` `/unmute SYMBOL` |
| Coins | `/addcoin SYMBOL PAIR #COLOR [Name]` (confirm required) `/history SYMBOL [channel]` |
| Channels | `/channels` `/addchannel name chat_id` `/removechannel name` `/setdefaultchannel name [type]` `/cleardefaultchannel type` |
| Captions | `/setcaption TYPE[:SYMBOL] <template>` `/previewcaption TYPE[:SYMBOL]` `/resetcaption TYPE[:SYMBOL]` `/variables` `/setvar name value` `/delvar name` |
| Automation | `/schedule <line>` `/schedules` `/addrule <line>` `/rules` |
| Broadcast | `/broadcast CHANNEL message text` |
| Backup | `/exportconfig` `/importconfig` |
| Reset | `/reset [thresholds\|milestones\|cooldowns\|captions\|vars\|channels\|automation\|everything]` |
| Stats | `/stats` `/digestnow` |
| Testing | `/test [SYMBOL]` `/test fail binance` `/test fail telegram` |

## Testing without internet

Escalated again for v0.4.0's amount of new interconnected DB-backed logic:

- Full syntax check + the entire module graph `require()`'d against stub
  `pg`/`ioredis`/`telegraf`/`express`/`sharp` packages.
- **`bot.js` actually booted** against the stubs with a timeout — startup
  sequence, a real poller tick, clean `SIGTERM` shutdown, all watchdog/
  scheduler inits (now including `automationScheduler.js`).
- **The exact scenario requested** — a custom $500 BTC milestone step
  crossing 71,500 → 72,000 → 72,500 in both directions — was tested
  directly against `poller.js`'s crossing-detection function with that
  exact step size, confirming it fires on every crossing and stays silent
  within a band.
- The **milestone override merge logic** (custom step / explicitly
  disabled / factory-default fallback) was tested against fixture DB rows
  covering all three states plus a stablecoin with no factory default.
- The **per-symbol caption override lookup** was tested end-to-end with a
  fixture DB returning a BTC-specific override: confirmed BTC gets the
  custom wording and ETH is unaffected, falling back to the shared default.
- **Rule magnitude conditions** were tested against fixtures — a move
  below the threshold correctly doesn't match, above it does (using
  absolute value so a downward move still qualifies), and a milestone
  alert (no % to compare) correctly never matches a `min:` rule.
- **Every reset handler** (thresholds/milestones/cooldowns/captions/vars/
  channels/automation/everything, plus an unknown-type guard) was run
  against the stub DB to confirm none throw.
- The `/cancel` escape hatch and the "lost track of what you were
  entering" fallback in the guided-input dispatcher were both exercised
  with a mock chat context.
- Every new screen's `callback_data` was checked against Telegram's
  64-byte limit with worst-case inputs (longest symbol, 3-digit IDs, a
  19-character channel name) — everything measured comes in under 26
  bytes.

**One honest scoping note**: `/importconfig` is paste-based (you copy the
exported JSON's text and send it as a message) rather than accepting an
uploaded file directly. A true file-upload flow needs the bot to call
Telegram's `getFile` API and fetch the file content by URL using the bot
token — a code path with real failure modes (auth, redirects, size limits)
that I can't exercise at all without live network access, so I chose the
version I could actually verify end-to-end over one I'd be guessing at.
`/exportconfig` still produces a real downloadable file either way.
