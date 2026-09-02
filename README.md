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
  threshold edit looks unusually large (50\u00D7+ the typical default), and a
  typo guard on `/addcoin` that catches near-miss symbols — including
  letter-swap typos like XPR\u2194XRP, not just missing/extra letters.
- **Live pair validation on `/addcoin`** — checks the Binance pair
  actually exists before confirming, instead of trusting whatever's typed.
  This matters beyond just that one coin: Binance's batched price endpoint
  (one call fetches every tracked coin's price) rejects the *whole*
  request if even one symbol in it is invalid, so an unchecked bad pair
  could silently break price fetching for every coin, not just the new
  one. `fetchAllPrices()` also now falls back to per-pair requests if the
  batch ever fails for some other reason (e.g. a previously-good pair
  gets delisted later), so one bad pair degrades to "that one coin has no
  price" instead of taking every alert down with it.
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

BTC, ETH, USDT, XRP, BNB, USDC, SOL, TRX, DOGE, XAUT ship with the bot out
of the box — see `src/coins.js` for brand colors, Binance pairs, and
default thresholds/milestone steps. These 10 are baked in; anything past
them has to be added, there's no separate "pre-added" list beyond this.

More can be added at runtime with `/addcoin SYMBOL PAIR #COLOR [Name]`
(confirm required, no redeploy) — or the button flow: `/commands` \u2192
Coin settings \u2192 Add coin. Also removable directly from that coin's
settings screen now, not just from the `/coins` list. `/coins` (or Coin
settings \u2192 View all coins) shows everything currently tracked and
marks which ones were custom-added. Those can be removed again with
`/removecoin SYMBOL` or the \u2716 button next to it in that list \u2014
the original 10 can't be removed this way, only ones added via
`/addcoin`.

**Adding several at once**: paste multiple `SYMBOL PAIR #COLOR [Name]`
lines in one message (an `/addcoin` or `/addcoins` prefix per line is
fine too, if that's how you already have them written — handy for
pasting a batch straight out of notes). Each line is checked
independently: already-tracked symbols are reported and left alone,
never overwritten; each new pair is verified against Binance before
being added; results come back as one summary (added / already tracked /
invalid pair / couldn't parse). A symbol is matched only by its own name,
not by which quote currency it's paired against — `/addcoin BTC BTCUSDC`
when BTC is already tracked via BTCUSDT is correctly rejected as
already-tracked (naming the existing pair), rather than silently
creating a second, conflicting BTC entry. To point an existing coin at a
different quote pair, `/removecoin` it first, then re-add with the new
pair.

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
- **Rule direction filter** — a rule can be scoped to "up only" or "down
  only" moves, not just any direction. Set via the button wizard (see
  below); the raw `/addrule` line syntax doesn't expose it.
- **Rule action: mute another coin** — a rule can mute a *different* coin
  for a set duration when it fires (e.g. "BTC drops 5%+ \u2192 mute ETH for
  1h" to cut noise during a correlated move).
- **Coin tags/groups** — `/tag BTC layer1` (or the button flow: Automation
  \u2192 Tags \u2192 Tag a coin) groups coins under a freeform label. Works
  for both built-in and custom-added coins. `/tags` lists every tag and how
  many coins are in it; `/untag SYMBOL TAG` removes one.
- **Movers summary** — `/movers` shows top gainers/losers (24h) across
  every tracked coin; `/movers tag:defi` scopes it to one tag. Also
  reachable via Automation \u2192 Movers.
- **Bulk actions** — Automation \u2192 Bulk actions applies a threshold or
  a mute to every coin in a scope (all coins, or one tag) in a single
  pass instead of one at a time.
- **Button-driven rule builder** — `/commands \u2192 Automation \u2192 Rules
  \u2192 Add rule` walks through trigger type, coin, direction, minimum
  move, action, and action-specific params (channel, chart period, mute
  target/duration) entirely with buttons. The only typed-text steps are a
  custom minimum % and a broadcast message body, since those are
  inherently free-form. The raw `/addrule <line>` text command still works
  too, side by side with the buttons.
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
| Coins | `/addcoin SYMBOL PAIR #COLOR [Name]` (confirm required) `/removecoin SYMBOL` `/coins` `/history SYMBOL [channel]` |
| Channels | `/channels` `/addchannel name chat_id` `/removechannel name` `/setdefaultchannel name [type]` `/cleardefaultchannel type` |
| Captions | `/setcaption TYPE[:SYMBOL] <template>` `/previewcaption TYPE[:SYMBOL]` `/resetcaption TYPE[:SYMBOL]` `/variables` `/setvar name value` `/delvar name` |
| Automation | `/schedule <line>` `/schedules` `/addrule <line>` `/rules` `/tag SYMBOL TAG` `/untag SYMBOL TAG` `/tags` |
| Movers | `/movers [tag:NAME]` \u2014 also its own top-level button (not nested under Automation), with a "Post to channel" action |
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
