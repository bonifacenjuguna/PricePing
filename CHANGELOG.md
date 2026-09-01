# Changelog

All notable changes to PricePing are logged here. Dates are approximate
(this project doesn't tag releases with real calendar dates).

## v0.6.3 — Compact card content centering

**Changed**
- Compact card content (logo, price, badge, watermark) nudged further
  inward toward center — canvas size unchanged (still the same width
  and height as v0.6.1/v0.6.2).

---

## v0.6.2 — Test/preview parity, watermark, caption layout

**Fixed**
- `/test SYMBOL`, the advanced `/test` picker (threshold + milestone),
  and the full pipeline check (`/test full`) now all read the actual
  `/cardstyle` setting before sending — previously they ignored it and
  always rendered the full (tall) card, so a test could look completely
  different from what a real alert actually posts.
- Compact card: watermark raised off the bottom edge a bit.

**Changed**
- Threshold and milestone captions are now 2 lines instead of 3 — the
  `%`/milestone line and `@PricePing` now share the second line, with
  extra spacing between them. Only affects channels still on the
  built-in default caption; anyone with a custom `/setcaption` template
  keeps their own layout (run `/resetcaption` to pick up the new
  default).

---

## v0.6.1 — Compact card fixes

**Fixed**
- Compact card: price text no longer overlaps the logo circle.
- Compact card: widened the canvas (1080→1300, height unchanged) and
  pushed the logo/badge/watermark inward so Telegram's chat-list crop
  (which clips the left/right edges of wide images in the feed preview)
  lands on blank margin instead of content.
- Caption `{channel_handle}` fallback now always includes the `@` prefix
  (was rendering as `PricePing` instead of `@PricePing` for channels
  without an `@username`-style chat ID).
- `/test` and `/previewcaption` now render using the actual `/cardstyle`
  setting — previously always rendered the full (non-compact) card
  regardless of what was configured, so the preview never matched what
  automatic alerts actually sent.

---

## v0.6.0 — Safety, personalization, and role-based access (partial pass on the full backlog)

This is one pass through the large backlog below, not the whole thing —
see "Backlog" at the end for everything still outstanding.

**Added**
- `{coin_emoji}` caption variable — every tracked coin now has an emoji
  identity (🟠 BTC, 🔷 ETH, 🐕 DOGE, etc., see `src/coins.js`).
- Threshold/milestone ± buttons now step by a "nice" round number (1/2/5 ×
  a power of 10) close to 10% of the current value, instead of an exact-
  but-fussy 10% — e.g. a $0.02 XRP threshold now steps by $0.005, not
  $0.002.
- Adaptive Telegram rate-limit backoff — a 429 response's actual
  `retry_after` value is now respected instead of a blind fixed 2s delay.
- **Multi-admin viewer role** — `VIEWER_TELEGRAM_IDS` (comma-separated)
  grants read-only co-admins access to status/prices/history/stats/etc.
  without letting them change anything. Every mutating command and
  button stays owner-only.
- **Kill switch** — one tap on Home stops everything (global pause + a
  snapshot of every coin's current mute state); a second tap restores
  exactly what was running before, including which specific coins were
  muted.
- **Caption packs** — `/applycaptionpack professional|meme|minimal` (or
  Captions → "🎨 Apply a caption pack") applies a ready-made caption style
  to all four alert types at once; still fully editable afterward.
- **Usage analytics** — `/usage` shows which commands actually get used
  and how often, tracked automatically by a lightweight bot-level
  middleware.
- **Audit log** — `/auditlog` (or Settings → "📋 Audit log") shows the last
  15 config changes in plain English: threshold/milestone/cooldown edits,
  channel removal, caption changes, schedule/rule removal, pause/mute,
  new coins, resets, and kill-switch use.
- **Quiet hours** — `/quiethours START END` (UTC) holds threshold and
  milestone alerts during a window (correctly handles overnight windows
  like 22:00-07:00), then lets the next real comparison catch up once it
  ends; post/chart schedules pause too, digests are exempt since the
  admin already chose their hour on purpose.
- **Milestone visual tiering** — crossing a "big" round number (10× the
  coin's step, e.g. every $5,000 for a $500-step coin) now gets a 🎉
  prefix and a more prominent badge on the card, distinct from routine
  crossings.
- **Compact card style** — `/cardstyle compact|full` (or a toggle on
  Settings) switches every automatic alert card to a smaller, subtitle-
  free layout for channels that want less visual noise per post.

---

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
conversations but isn't in the codebase yet. This list is worked through
version by version — v0.6.0 closed out the items marked done in that
section above. Listed here so nothing gets lost.

**Queued next**: per-schedule coin selection for digests (the
`schedules.symbols` column exists from the v0.6.0 migration but isn't
wired into `digest.js`/`automationScheduler.js` yet), optional local-
timezone display, breadcrumb text on nested screens, pagination for long
schedule/rule lists.

**Market intelligence**: velocity/acceleration alerts, volume spike
alerts, divergence alerts (e.g. BTC vs ETH), ATH/ATL distance tracking +
alerts, "quiet coin" report, correlation snapshot (e.g. BTC vs gold),
volatility-regime detection, multi-timeframe milestone context ("last hit
this level 3 days ago"), `/compare BTC ETH 7d` normalized chart.

**Content & format**: card themes (minimal/retro/holiday), Telegram poll
auto-attached to milestone posts, per-channel branding, rotating "mood"
captions (`{random:...}` syntax).

**Operational / safety**: dry-run/preview mode for new automation before
it goes live.

**Distribution & reach**: outbound webhook rule action (Discord/Zapier/
etc.), shareable per-alert web permalink.

**Fun**: year-in-review recap card, streak counters, coin-specific flavor
lines, anniversary alerts ("this day last year, BTC was $X"), time-capsule
posts (schedule a one-off message for a future date), "coin of the week"
spotlight, community suggestion inbox routing into `/addcoin`.
*(Prediction game explicitly excluded per instruction.)*

**Further polish**: plain-English validation preview before creating a
rule/schedule, "what changed since yesterday" digest addendum, emoji-
reaction tracking in `/stats`.
