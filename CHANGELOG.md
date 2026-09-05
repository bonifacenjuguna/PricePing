# Changelog

All notable changes to PricePing are logged here. Dates are approximate
(this project doesn't tag releases with real calendar dates).

## v0.9.0 — Navigation redesign, timezone support, fixed a real data-loss bug

**Fixed \u2014 the important one**
- Milestone alerts held back by the hourly send cap had their "already
  alerted" state recorded *before* the cap was even checked \u2014 so a
  capped milestone could never be detected again next tick, silently and
  permanently lost, contradicting the existing code comment's claim that
  nothing gets lost. (Threshold alerts never had this bug \u2014 their
  baseline only ever advanced on an actual successful send.) Fixed by
  deferring the milestone state update until after it actually sends,
  same pattern threshold already used. Bonus fix that fell out of the
  same change: a milestone suppressed by quiet hours had the identical
  problem \u2014 also fixed.
- The cap-reached notification was deduped with an in-memory flag, which
  reset on every restart \u2014 and this bot gets redeployed often (a zip
  upload, not a long-running process), so it was refiring the warning
  mid-episode on every redeploy. Now DB-backed.

**Added**
- Held-back alerts are now logged (new `held_back_alerts` table) instead
  of vanishing into a warning message. `/heldback`, also Safety & Admin
  \u2192 Held-back alerts.
- Timezone support: `/settimezone [IANA_TZ]` (also a button picker with
  presets). `/schedule` and `/quiethours` now take and display **local**
  time instead of requiring UTC, converted under the hood via Node's
  built-in `Intl` (no dependency, DST-aware). Defaults to UTC \u2014
  nothing changes until set explicitly.
- Full navigation redesign: `/start` and `/commands` are now the exact
  same unified dashboard (previously two different, inconsistent
  screens) with six categories \u2014 Markets, Coins, Publish, Automation,
  Channels, Safety & Admin \u2014 instead of a flat 20-button list. Fixed
  Captions having no top-level entry point after the reorg (moved to the
  Channels screen). Every screen's "Back" button re-pointed to its actual
  logical parent under the new structure. Fresh installs get sensible
  default pinned shortcuts now, since a couple of actions sit one tap
  deeper under the new grouping.

**Migration note:** run `npm run migrate` after deploying \u2014 adds
`held_back_alerts` (new table, doesn't touch existing ones).

---

## v0.8.2 — Navigation overhaul: hub reorg, cross-links, 2x3 + contextual BBTB

A deliberate pass on navigation specifically — not new features, fixing
how you find and reach the ones already there.

**Fixed**
- `/commands` hub had two real orphans: Settings and Broadcast both
  existed as full screens with no direct top-level button pointing at
  them (Settings was only reachable by typing `/settings`; Broadcast only
  by finding it nested inside the Channels screen). Both are proper hub
  buttons now.
- `home()` (the `/start` status screen) never got Markets or Movers added
  when those features shipped \u2014 fixed.

**Changed**
- Hub reorganized so related things sit next to each other (Post & Chart
  + Coin settings, Markets + Movers, Automation + Channels, Broadcast +
  Fear & Greed, ...) instead of a flat list in build order. Settings and
  Reset deliberately left as isolated single-button rows \u2014 admin and
  destructive actions, not an oversight.
- Added direct cross-links between related sections that previously
  required detouring through the hub: Coin settings \u2194 Markets,
  Automation \u2192 Markets.
- Persistent bottom keyboard (BBTB) expanded from 2\u00D72 to 2\u00D73:
  Home, Prices, Markets, Thresholds, Stats, Movers. Tapping Markets swaps
  to a Markets-focused layout (Home, Markets, Coins, Movers, Fear &
  Greed, Prices); tapping Home there swaps back. Documented the one real
  constraint this runs into in the README \u2014 Telegram can't attach a
  keyboard change to an edited message, so this can only trigger from an
  actual BBTB tap, never from inline navigation.
- The pinnable "\u2B50 Quick actions" row (Settings \u2192 Quick actions)
  now includes Markets, Movers, Fear & Greed, Automation, and Coin
  settings \u2014 these didn't exist yet when that catalog was first
  built, so they were never addable.

---

## v0.8.1 — Multi-select coin picker

**Added**
- Coin settings \u2192 Select multiple: a tap-to-check/uncheck coin picker
  (\u2705/\u2B1C, updates in place on every tap) with its own Remove /
  Mute / Set-threshold actions applied to whatever ended up selected. A
  third way to scope a bulk action, alongside the existing "all coins" or
  "one tag" options in the Bulk actions wizard \u2014 this one's for an
  ad-hoc set that doesn't already share a tag. Remove reuses the same
  batch-confirm flow as `/removecoin SYM1 SYM2 ...`.

---

## v0.8.0 — Markets hub: auto-classification, Top 20, batch /removecoin

**Added**
- `/markets` (also its own hub button): dynamic category browser \u2014
  every category button reflects the database live, none hard-coded.
  Categories: Layer 1, Layer 2, DeFi, AI & DePIN, Gaming & Metaverse,
  Memecoins, plus Uncategorized when relevant.
- Auto-classification via CoinGecko (free, no key) on every `/addcoin`
  (single or bulk): resolves the coin there, reads its categories +
  market cap rank, keyword-maps categories to the fixed set above, tags
  it (a coin can land in more than one), caches the CoinGecko id + rank
  in a new `coin_meta` table. Binance's own API has no category data at
  all \u2014 this had to be a different source. See the README's Markets
  section for exactly what this is and isn't (keyword-based, not a
  weighted-confidence/web-research classifier).
- Top 20 (by market cap rank), Top Gainers/Losers (dedicated top-10
  single-direction lists, separate from the existing side-by-side
  `/movers`), and a Watchlist (\u2B50 toggle button on any coin's settings
  screen \u2014 one shared list, since this bot is single-admin
  throughout).
- "\uD83D\uDD04 Refresh classification" on the Markets hub: re-runs
  classification for anything never classified or >14 days stale, since
  there's no background scheduler doing this automatically (would mean
  unattended CoinGecko calls against its rate limit).
- `/removecoin` now takes multiple symbols at once
  (`/removecoin ADA DOGE AAVE`), same non-destructive-batch pattern as
  bulk `/addcoin` \u2014 one confirm, anything not tracked/not removable
  is reported and skipped rather than blocking the rest.
- Bulk `/addcoin` summary now includes a classification tally (how many
  landed in each category, how many uncategorized).

**Migration note:** run `npm run migrate` after deploying \u2014 adds
`coin_meta` (new table, doesn't touch existing ones).

---

## v0.7.8 — Custom coin logos vanishing after redeploy

**Fixed**
- Custom coins added via `/addcoin` would show a blank white circle
  instead of their logo after any redeploy/restart. Root cause: the
  original 10 coins' logos are baked into the Docker image at *build*
  time (`prepare-assets`), so they survive redeploys — but a custom
  coin's logo is only ever written to local disk at *runtime*
  (`/addcoin`), and Railway's filesystem is ephemeral by default, so
  that file doesn't survive the next deploy. The coin itself was fine
  (its symbol/pair/color live in Postgres and reload correctly), but
  nothing ever re-fetched its *logo file* \u2014 `compositeLogo()` just
  silently found no file and skipped compositing, leaving the card's
  white backing circle with nothing on it. `loadCustomCoins()` now
  regenerates any custom coin's logo that's missing on boot, so this
  self-heals on the next restart with no persistent volume needed.
  Scanned for other runtime-written files with the same problem \u2014
  this was the only one.

---

## v0.7.7 — Critical fix: missing require broke /coins and coin settings; rich broadcast; Fear & Greed

**Fixed \u2014 the important one**
- `customCoinsDb` was used throughout `commands.js` (`/coins`, clicking a
  coin in Coin settings, `/removecoin`) but never actually `require()`'d
  in that file. Every one of those threw a silent `ReferenceError` server
  -side \u2014 nothing visibly happened on tap, `/coins` did nothing.
  This has been broken since v0.7.4. Fixed by adding the missing
  `require`. Re-scanned every DB/service reference across the whole
  `src/` tree for the same class of bug \u2014 this was the only one.

**Added**
- `/broadcast` now supports any media type, not just plain text: `/broadcast
  CHANNEL` alone (nothing after) puts it in "waiting for content" mode \u2014
  send/forward the next message, text or photo/video/document/voice/GIF/
  anything, and it's copied into the channel exactly as sent, formatting
  intact, via Telegram's `copyMessage` rather than `forwardMessage` \u2014
  which means no "Forwarded from" tag. The inline form (`/broadcast
  CHANNEL text right here`) still works for quick plain-text posts, and
  now documents how to add a hyperlink: `<a href="https://example.com">link
  text</a>` (also `<b>bold</b>`, `<i>italic</i>`).
- `/feargreed` (or `/fng`), also its own hub button: the Crypto Fear &
  Greed Index from alternative.me, with attribution per their terms.

---

## v0.7.6 — Remove-from-settings, bulk /addcoin, Movers promoted, pair clarity

**Added**
- Coin settings screen now has a \uD83D\uDDD1 Remove coin button directly
  on it (for custom-added coins), not just via the separate `/coins` list.
- `/addcoin` (and the new `/addcoins` alias) now accepts several lines at
  once, one coin per line \u2014 handy for pasting a whole batch. Each line
  is independently checked: already-tracked symbols are reported and left
  completely alone (never overwritten), each new pair is validated
  against Binance, and one summary comes back at the end (added / already
  tracked / invalid pair / couldn't parse). Non-destructive by
  construction \u2014 it only ever adds, never touches an existing coin.
- Movers is now its own top-level hub button (previously nested under
  Automation), and its screen now has a "Post to channel" action \u2014
  pick a channel and it posts the same summary there instead of just
  showing it privately.

**Changed**
- The "already tracked" rejection on `/addcoin` now names which pair the
  symbol is already tracked under, since a symbol is matched by name only
  \u2014 not by quote currency. `/addcoin BTC BTCUSDC` while BTC is
  already tracked via BTCUSDT is correctly rejected (a coin can only track
  one pair at a time), and the message now says so explicitly instead of
  a bare "already tracked."

---

## v0.7.5 — Validate Binance pairs before adding

**Fixed**
- `/addcoin` previously trusted whatever Binance pair was typed, with no
  check it actually exists. That was riskier than just "the new coin
  won't work" \u2014 every coin's price is fetched in one batched Binance
  call, and Binance's batched ticker endpoint rejects the *entire*
  request if even one symbol in it is invalid. An unchecked bad pair
  could silently break price fetching (and therefore every alert) for
  *every* tracked coin, not just the new one.
- New `binance.pairExists()`: `/addcoin` now checks the pair against
  Binance directly before showing the confirm screen, and rejects it up
  front with a clear message if it's not real.
- `marketData.fetchAllPrices()` now also falls back to per-pair requests
  if the batched call fails for any other reason (e.g. a previously-good
  pair gets delisted later) \u2014 degrades to "that one coin has no
  price" instead of taking every coin down with it.

---

## v0.7.4 — /coins, /removecoin

**Added**
- `/coins` (or Coin settings \u2192 View all coins): lists every tracked
  coin and marks which were added via `/addcoin` vs. the original 10.
  There was previously no single place to see the full list.
- `/removecoin SYMBOL` (with confirm, same pattern as `/addcoin`), or the
  \u2716 button next to a coin in `/coins`. Only removes coins that were
  themselves added via `/addcoin` \u2014 the original 10 in `coins.js`
  aren't removable this way. Cleans up the coin's threshold-default row,
  tags, and downloaded logo file along with it.
- `src/services/coinRegistry.js`: new `removeCoin()`, symmetric with the
  existing `addCoin()`.

---

## v0.7.3 — Coin tags, movers summary, bulk actions

**Added**
- Coin tags/groups: `/tag SYMBOL TAG`, `/untag SYMBOL TAG`, `/tags`, plus a
  button flow (Automation \u2192 Tags). Freeform labels (e.g. "layer1",
  "meme"), works for both built-in and custom-added coins. New
  `coin_tags` table (migration `008_v0_7_3.sql`).
- `/movers [tag:NAME]`: top gainers/losers (24h) across every tracked
  coin, or scoped to one tag. Also reachable via Automation \u2192 Movers.
  Reuses the same 24hr-stats batch the digest already fetches.
- Bulk actions (Automation \u2192 Bulk actions): apply a threshold or a
  mute to every coin in a scope \u2014 all coins, or one tag \u2014 in a
  single pass instead of one at a time.

**Migration note:** run `npm run migrate` after deploying \u2014 adds
`coin_tags` (new table, doesn't touch existing ones).

---

## v0.7.2 — Button-driven rule wizard, richer automation

**Added**
- `/commands \u2192 Automation \u2192 Rules \u2192 Add rule` is now a full
  button wizard: trigger type \u2192 coin \u2192 direction \u2192 minimum
  move \u2192 action \u2192 action-specific params (channel, chart period,
  mute target/duration) \u2014 all taps. Only a custom minimum % and a
  broadcast message body are still typed text, since those are inherently
  free-form. The raw `/addrule <line>` command still works too.
- Rules can now filter by direction ("up only" / "down only"), not just
  trigger type/symbol/minimum move. New `trigger_direction` column
  (migration `007_v0_7_2.sql`, additive/nullable \u2014 existing rules keep
  matching either direction).
- New rule action: **mute another coin** \u2014 e.g. "BTC drops 5%+ \u2192
  mute ETH for 1h" to cut correlated noise.

**Changed**
- New internal `wizardState.js` service: multi-step button flows now keep
  accumulated state server-side instead of trying to round-trip it all
  through callback_data (which has a hard 64-byte limit per tap).

---

## v0.7.1 — Sparkline/watermark overlap, drop Binance credit

**Fixed**
- Manual-post rich card: the embedded 24h sparkline and the `@PricePing`
  watermark occupied almost the exact same y-range, so a downward-trending
  line would visually cross through the watermark text. Raised the
  sparkline so its bottom clears the watermark.

**Removed**
- `/chart`: dropped the "Source: Binance" footer text — only credit shown
  on any card/chart is `@PricePing`.

---

## v0.7.0 — Premium chart redesign, candlestick style

**Added**
- Candlestick chart style: real OHLC wicks + bodies (green/red), same
  premium chrome as the line style. Binance klines now carry open/high/low
  through the data layer (`binance.js`, `marketData.js`), not just close.
- `/chart` flow (button-driven) now asks Line or Candles right after
  picking a coin, before the period picker. `/chart SYMBOL [period]
  [line|candle]` and `/postchart SYMBOL [period] [channel] [line|candle]`
  take the style as an optional trailing word too.

**Changed**
- Full chart redesign — the previous version was flat and sparse
  (gridlines + a line, nothing else). Now: brand-color-tinted diagonal
  background gradient, a corner glow, the coin's logo composited into the
  header (matching the alert-card treatment), vertical time-axis gridlines
  with labels alongside the existing horizontal price gridlines, dashed
  HIGH/LOW reference lines, a richer multi-stop area-fill gradient, a
  double-layer glow on the line stroke, and a glowing marker dot at the
  latest price.
- Chart price grid now spans the period's true high/low range (previously
  it only spanned the close-price range), so gridlines, high/low markers,
  and the candlestick wicks all share one consistent scale.

## v0.6.8 — Detailing that actually survives compression, colon caption

**Changed**
- The v0.6.7 gradient/shadow/glow effect was too subtle to survive
  Telegram's shrink-to-thumbnail + JPEG re-encode — it looked right at
  100% but flattened out at the size people actually see it. Pushed the
  gradient contrast and shadow strength up substantially, and added a
  corner vignette (all card types + chart) so the depth reads at a
  glance even after compression, not just on close inspection.
- Caption separator changed from an em dash to a colon —
  `Name: $price @PricePing` — since a colon reads as "label: value",
  which is literally what this is, instead of an arbitrary symbol
  between two chunks of text.

## v0.6.7 — Card detailing: gradient background, shadows, glow

**Changed**
- All card types (threshold, milestone, manual, compact, chart) moved
  off a flat solid-color fill to a subtle diagonal gradient (same hue,
  lighter-to-darker) for depth.
- Added a soft radial glow behind the logo disc, and drop shadows under
  the logo, price, coin name, and badge/pill elements so they read as
  layered rather than flat-pasted.
- Chart (`/chart`, `/postchart`): background is now a subtle vertical
  gradient instead of flat dark fill, and the price line has a soft
  colored glow under the crisp stroke (neon-chart look).
- Deliberately did NOT add a grain/noise texture — fine per-pixel noise
  compresses badly under Telegram's forced JPEG re-encode and would
  fight the v0.6.6 sharpness work. Gradients and blurred shadows were
  used instead since they survive that re-encode cleanly.

## v0.6.6 — Sharper renders, symbol dropped from captions

**Changed**
- Default captions (threshold, milestone, manual, chart) no longer repeat
  `(SYMBOL)` — it's already on the card image itself — and dropped the
  `·` separator in favor of a single space (non-breaking, so Telegram
  can't wrap `@PricePing` onto its own line): `Name — main info @PricePing`.
- All cards and charts now rasterize at 3x their layout size (via SVG
  density, not by touching any coordinate) before being flattened to
  PNG, so there's meaningfully more real pixel data for Telegram's
  forced JPEG re-encode to work with. Added a light sharpen pass and
  tuned PNG compression on top.
- Coin logos are pre-rendered at 512px instead of 256px (both the
  build-time asset script and the `/addcoin` runtime path), with a
  higher-quality resize kernel, so the logo doesn't become the blurry
  weak link once everything else is sharper.

## v0.6.5 — One-line captions

**Changed**
- All four default captions (threshold, milestone, manual, chart)
  collapsed to a single line: `Name (SYMBOL) — main info  ·  @PricePing`.
  Dropped the %/milestone-level/24h-stats line from each — that data is
  already shown on the card image itself (badge, stats row), so
  repeating it in text was pure duplication. Only affects channels
  still on the built-in default; anyone with a custom `/setcaption`
  keeps their own layout (`/resetcaption` to pick up the new default).

---

## v0.6.4 — Chart crop fix + more compact-card inset

**Fixed**
- `/chart` and `/postchart`: same crop problem as the alert cards —
  title, price/%, and watermark sat flush against the edges. Widened
  the canvas (1080→1260, height unchanged) and shifted everything
  inward so Telegram's chat-list crop lands on blank margin.
- Compact alert card: increased the inward inset further (logo/price
  right, badge/watermark left) — the previous nudge wasn't enough to
  fully clear the crop zone.

**Changed**
- Chart: rounded card corners, and the % change is now a colored pill
  badge (matching the alert cards) instead of plain colored text.

---

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
