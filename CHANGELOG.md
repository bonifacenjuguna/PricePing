# Changelog

All notable changes to PricePing are logged here. Dates are approximate
(this project doesn't tag releases with real calendar dates).

## v0.5.0 — Undo, safety rails, and preview/history/pin upgrades

**Added**
- Generic undo (`services/undoStack.js`) — replaces the old threshold-only
  undo. An "↩ Undo" button now appears after: `/setthreshold` (exact),
  `/setmilestone` (exact + off), `/setcooldown`, removing a channel,
  setting/resetting a caption, and removing a schedule or rule. Time-boxed
  (15 minutes) and capped at the 8 most recent actions.
- Hard cooldown floor — `/setcooldown` and the ± buttons can no longer go
  below 1 minute, closing off an accidental spam-loop.
- Threshold sanity-check — `/setthreshold` warns (but still applies, your
  call) when a `usd`-type amount is 50×+ the coin's typical default.
- Symbol-confusion guard on `/addcoin` — warns on the confirm screen if
  the new symbol is a likely typo of an already-tracked one (uses
  Damerau-Levenshtein distance, so it catches letter swaps like
  XPR↔XRP, not just missing/extra letters).
- Channel `chat_id` validation on `/addchannel` — calls Telegram's
  `getChat` before saving; a bad ID is rejected immediately with nothing
  written, instead of silently failing the first time something tries to
  post there.
- Overwrite notes — re-adding an existing channel name or caption key now
  says what it replaced, instead of silently overwriting.
- Delisted/renamed-symbol detection — the poller now tracks consecutive
  ticks where a coin returns no price; after ~10 minutes it DMs the admin
  once (distinct from a full Binance outage, which already had this).
- Caption preview now sends the **real rendered card or chart image**
  alongside the caption text, not just the text — for all four alert
  types.
- `/history` pagination — Newer/Older buttons once a coin has more than
  10 logged alerts, backed by a proper offset+count query.
- Coin settings screen: a "why is this coin quiet?" line that
  distinguishes global pause / per-coin mute / no threshold set /
  milestones disabled (previously all four looked identical from the
  outside), a last-alert timestamp, a one-line threshold-vs-milestone
  coexistence explainer, and a "💰 Post now" shortcut.
- "⭐ Quick actions" — pin up to 3 shortcuts (from a fixed safe catalog)
  to an extra row on Home, managed from Settings → Quick actions.
- `/feed.json` — a public read-only JSON endpoint on the existing Express
  server listing the 20 most recent alerts, for syndicating PricePing
  data outside Telegram without needing bot access.
- This file.

**Fixed**
- Caption per-coin-override button no longer shares an icon (🎯) with the
  milestone buttons.

**Changed**
- Every new feature above that has a slash-command form also has a full
  button path — nothing added in this release is command-only.

---

## v0.4.1 — Full button parity audit

Every command that only had a slash-command path got a button flow:
`/addcoin` (via Coin settings → "➕ Add coin"), `/milestones` overview,
`/history` (+ channel-filter buttons), `/setvar`/`/delvar` (new "My
custom variables" screen), `/exportconfig`/`/importconfig` (new "💾
Backup" screen), `/whoami`, `/digestnow`, `/cleardefaultchannel` and
per-type `/setdefaultchannel`, per-coin `/setcaption TYPE:SYMBOL`
overrides, exact-value entry for thresholds/milestones (not just ±), and
a muted-coins summary/indicator on the Mute screen.

Verified by generating every `callback_data` value every screen actually
emits and running a sample through the real callback router with every
handler spied, confirming each one resolves — not just that the code
parses.

---

## v0.4.0 — Configurable milestones, reset, and per-coin/per-type control

**Added**
- `/setmilestone SYMBOL STEP|off` — milestone step size is now
  admin-editable and DB-backed (previously fixed in `coins.js`). This is
  the "alert me every $500 as BTC crosses 71,500 / 72,000 / 72,500..."
  feature.
- `/reset [thresholds|milestones|cooldowns|captions|vars|channels|
  automation|everything]` — scoped resets back to factory defaults, each
  requiring a button-tap confirmation.
- Unified coin settings screen (threshold + milestone + cooldown + mute
  in one place).
- Per-coin cooldown overrides, per-coin caption overrides
  (`type:SYMBOL`), per-alert-type default channels.
- Digest moved onto the generic `schedules` table (supports
  hourly/weekly cadences now, not just a fixed daily time; shows up in
  `/schedules`).
- Rule magnitude conditions (`min:PCT`) — a rule can require the
  qualifying move be at least X% before it fires.
- Schedule/rule editing (re-prompts with the current line pre-shown).
- Confirm-before-create on `/addcoin`.
- Recently-used coins row on picker grids; test menu remembers your last
  destination.
- `/exportconfig` / `/importconfig` (paste-based — see the note in
  README about why this isn't file-upload-based).

---

## v0.3.0 — Customization, per-channel targeting, automation, `/commands` hub

**Added**
- Fully customizable caption templates with 20+ variables
  (`/setcaption`, `/previewcaption`, `/resetcaption`, `/variables`,
  `/setvar`), replacing the old fixed caption strings.
- A real named channel registry (`/addchannel`, `/removechannel`,
  `/setdefaultchannel`, `/channels`) — every post-capable command/button
  now targets one channel by name instead of a blanket mirror-everywhere.
- Automation: recurring posts/charts (`/schedule`) and trigger→action
  rules (`/addrule` — mirror to another channel, post a chart, or
  broadcast a message on threshold/milestone/any alert).
- `/commands` — the full button-driven control panel hub.
- Advanced `/test`: coin → alert type → move-size preset → destination
  (including preview-only), a full-pipeline check, and genuine failure
  injection (`/test fail binance`/`telegram`).
- `/start` moved to first in the Telegram "/" command popup.

**Fixed**
- `accessGate` no longer replies "this bot is private" into the channel
  itself — it was scoped to *every* update instead of private chats only.

---

## v0.2.0 — Manual posts, charts, per-coin thresholds, milestones (fixed), automation basics

**Added**
- Manual price posts (bare symbol in chat, or `/post SYMBOL`) with a
  richer card (24h high/low/%, sparkline).
- `/chart` and `/postchart` — real price charts off Binance klines.
- Percentage-based thresholds alongside `$` thresholds.
- `/addcoin` — track new coins at runtime, no redeploy.
- Per-coin `/mute`, snoozable `/pause`/`/mute` durations.
- Milestone alerts (round-number crossings) — fixed step per coin in
  `coins.js` at this point, made editable later in v0.4.0.
- Hourly send cap, daily digest + "biggest mover," second-channel
  mirroring (superseded by the full channel registry in v0.3.0),
  `/history`, `/whoami`, undo button on `/setthreshold` (superseded by
  the generic undo in v0.5.0).
- Heartbeat dead-man's-switch, startup self-test render.

**Fixed**
- The channel "this bot is private" leak (first attempt — see v0.3.0 for
  the actual root-cause fix; this version narrowed but didn't fully close
  it).
- Removed a stray typo'd directory from the project scaffold.

---

## v0.1.5 — Baseline

The original working bot: Telegraf + Postgres + Redis + Binance polling,
SVG alert cards rendered via `sharp`, a private admin menu (Home / Prices
/ Thresholds / Stats), fixed per-coin thresholds and a 5-minute cooldown,
memory watchdog, Railway deployment via `nixpacks.toml`/`railway.json`.

---

## Backlog — proposed, not yet built

Everything below was discussed and locked in across planning
conversations but isn't in the codebase yet. Listed here so nothing gets
lost; each is a candidate for a future version.

**Market intelligence**: velocity/acceleration alerts, volume spike
alerts, divergence alerts (e.g. BTC vs ETH), ATH/ATL distance tracking +
alerts, "quiet coin" report, correlation snapshot (e.g. BTC vs gold),
volatility-regime detection, multi-timeframe milestone context ("last hit
this level 3 days ago"), `/compare BTC ETH 7d` normalized chart.

**Content & format**: card themes (minimal/retro/holiday), `{coin_emoji}`
variable, compact vs. detailed card toggle, Telegram poll auto-attached to
milestone posts, per-channel branding, rotating "mood" captions
(`{random:...}` syntax), big-milestone vs. routine-milestone visual
tiering.

**Operational / safety**: one-tap kill switch with snapshot + restore,
multi-admin viewer role, caption template packs (Professional/Meme/
Minimal), adaptive Telegram rate-limit backoff (respect `retry_after`).

**Bot self-awareness / meta**: command usage analytics, `/auditlog`,
dry-run/preview mode for new automation before it goes live.

**Distribution & reach**: outbound webhook rule action (Discord/Zapier/
etc.), shareable per-alert web permalink.

**Fun**: year-in-review recap card, streak counters, coin-specific flavor
lines, anniversary alerts ("this day last year, BTC was $X"), time-capsule
posts (schedule a one-off message for a future date), "coin of the week"
spotlight, community suggestion inbox routing into `/addcoin`.
*(Prediction game explicitly excluded per instruction.)*

**Further polish**: threshold/milestone step-sizing tuned to price
magnitude rather than a flat %, plain-English validation preview before
creating a rule/schedule, per-schedule coin selection for digests,
quiet-hours/weekend-aware scheduling, "what changed since yesterday"
digest addendum, emoji-reaction tracking in `/stats`, optional
local-timezone display, breadcrumb text on nested screens, pagination for
long schedule/rule lists.
