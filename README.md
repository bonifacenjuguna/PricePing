# PricePing

Telegram bot (`@PricePingAlertsBot`) that posts real-time crypto price alerts
to Telegram channels, plus a fully button-driven private admin panel for
managing it. Currently at **v0.6.0**. Full version history and the
complete feature backlog live in [`CHANGELOG.md`](./CHANGELOG.md).

## What's new in v0.6.0

- **Multi-admin viewer role** (`VIEWER_TELEGRAM_IDS`) — read-only
  co-admins who can check status/prices/history/stats but can't change
  anything.
- **Kill switch** on Home — one tap stops everything and snapshots
  exactly what was running; a second tap restores it precisely.
- **Quiet hours** (`/quiethours START END`) — hold alerts during a window
  (handles overnight wraparound), catch up once it ends.
- **Caption packs**, **`{coin_emoji}`**, **milestone visual tiering** (big
  crossings get a 🎉 treatment), **compact card style**, **usage
  analytics** (`/usage`), and an **audit log** (`/auditlog`) of recent
  config changes.
- Threshold/milestone ± buttons now step by round numbers instead of an
  exact-but-fussy 10%, and Telegram rate-limit backoff now respects the
  server's actual `retry_after` value.

## What's new in v0.5.0

- **Generic undo** — an "↩ Undo" button now follows `/setthreshold`,
  `/setmilestone`, `/setcooldown`, channel removal, caption set/reset, and
  schedule/rule removal. Replaces the old threshold-only undo from v0.2.0.
  Time-boxed to 15 minutes, keeps the last 8 actions.
- **Safety rails**: a hard 1-minute cooldown floor, a soft warning when a
  threshold edit looks unusually large (50×+ the typical default), and a
  typo guard on `/addcoin` that catches near-miss symbols — including
  letter-swap typos like XPR↔XRP, not just missing/extra letters.
- **Channel validation** — `/addchannel` now confirms the bot can actually
  see the chat before saving; a bad ID is rejected immediately instead of
  failing silently on the first real post.
- **Delisted/renamed-symbol detection** — the poller flags a coin that's
  stopped returning a price for ~10 minutes, distinct from a full Binance
  outage.
- **Caption preview shows the real card** — `/previewcaption` now renders
  and sends the actual image alongside the caption text, for all four
  alert types, not just the wording.
- **`/history` pagination** — Newer/Older buttons once a coin has more
  than 10 logged alerts.
- **Coin settings clarity** — a "why is this coin quiet?" line
  (distinguishing pause / mute / no threshold / milestones-off, which
  previously all looked identical), a last-alert timestamp, and a
  "💰 Post now" shortcut right on the settings screen.
- **"⭐ Quick actions"** — pin up to 3 shortcuts to an extra row on Home.
- **`/feed.json`** — a public read-only JSON feed of recent alerts, for
  syndicating PricePing data outside Telegram.

## What's new in v0.4.1

Every command that only had a slash-command path now has a full button
flow too — nothing in `/commands` is a shortcut-only feature anymore:

- **`/addcoin`** — "➕ Add coin" on the Coin settings screen
- **`/milestones`** overview — "🎯 All milestones" on the Coin settings screen
- **`/history SYMBOL [channel]`** — "📜 History" on the hub and on every
  coin's settings screen, with tap-to-filter-by-channel buttons
- **`/setvar` / `/delvar`** — a new "🔧 My custom variables" screen
  (via Captions → Variables) lists them with delete buttons and an add flow
- **`/exportconfig` / `/importconfig`** — a new "💾 Backup" screen off Settings
- **`/whoami`** — a button on the Settings screen
- **`/digestnow`** — a button on the Automation screen
- **`/cleardefaultchannel`** and per-type `/setdefaultchannel name TYPE`
  — a full picker flow off the Channels screen (pick alert type → pick
  channel), plus clear buttons for any existing per-type override
- **`/setcaption TYPE:SYMBOL`** per-coin overrides — "🎯 Per-coin overrides"
  on any caption's detail screen, with its own coin picker and edit/
  preview/reset per coin
- **Exact-value entry** for thresholds and milestones — "✏ Exact" next to
  the ± buttons on the coin settings screen, for setting a precise number
  without incrementing one step at a time
- **Muted-coins visibility** — the Mute screen now shows a summary line of
  who's currently muted and for how long, with a 🔇 marker on their button

Verified this time by generating every `callback_data` value that every
screen actually emits (184 across the full app) and running a
representative sample through the real callback router with every
`commands.*` function spied, confirming each one reaches a handler — not
just that the code parses.

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

## Testing without internet (v0.5.0 additions)

On top of the checks described below: the undo stack's push/consume/
time-box/8-entry-cap behavior was tested directly; the Damerau-Levenshtein
typo guard was verified against the exact XPR↔XRP transposition example
used to justify building it (a plain Levenshtein implementation would have
missed this — caught and fixed during testing); channel validation was
tested against both a valid and a rejected `getChat` response, confirming
nothing is saved on failure; and caption preview was confirmed to send an
actual rendered image (not just text) for all four alert types.

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
