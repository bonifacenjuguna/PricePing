# GitroHub Changelog

All notable changes to GitroHub. See [README.md](./README.md) for the current feature set and setup instructions.

---

### v0.1.0 — Initial release

The first release of GitroHub: a private, owner-only Telegram bot for managing your GitHub account end-to-end from a phone.

**Core**
- Owner-only gate — the bot responds to exactly one Telegram ID (`OWNER_ID`); everyone else is silently ignored, with zero processing and zero log noise.
- GitHub OAuth connect flow with a signed-JWT `state` parameter (binds the callback to the right Telegram chat) and an animated HTML confirmation page (particle background, circuit-line animation, live status feed, countdown auto-redirect back into Telegram).
- Access tokens encrypted at rest with AES-256-GCM, `repo`-scope only.
- One Node process running both the Telegraf bot (webhook or long-polling) and a small Express server for `/callback` and `/webhook/github`.

**Repos**
- Create, rename, delete, and toggle visibility.
- List with filter, sort, and fuzzy + weighted search (name, description, recency, star count).
- Fork any public repo; star/unstar from Search's external-repo screen.
- Clone URL shown in all three variants — HTTPS, SSH, `gh repo clone` — each tap-to-copy.
- Repo View: description, license, last 3 commits, README preview or full-file send, health flag, "last synced" size timestamp, Open in Browser.
- A repo rename cascades its tags, pin position, upload-path memory, mute state, and live webhook registration onto the new name in one transactional step.

**Files**
- Full tree navigation (Browse Files), view/send/edit/delete any file.
- Upload a single file or a `.zip` (auto-strips the GitHub-style wrapper folder), with 🆕 New / ✏️ Modified / ➖ Unchanged detection before committing.
- Batch Upload — collect several loose files into one combined commit and summary.
- Replace — swap a single file's content by sending a new one, or fully sync a folder (add/update/delete) with an explicit delete preview before committing.
- Upload Here — upload straight into the folder you're currently browsing, path pre-filled.
- Download any of your repos, or any public external repo pasted as a link.

**Organization**
- Pinned Repos, grouped into named sections, with drag-style reorder scoped per section.
- Tags — nested (e.g. "Work" → "Work/Client-A"), a fixed 6-color palette, optional auto-rules (language match, name pattern), and per-tag defaults for visibility/upload-path/commit-message.
- Smart Folders — save a composable filter (visibility + language + staleness + tag + name) as a named quick-access view.
- Recently Viewed and Search History, each clearable independently.

**Bulk actions**
- Multi-select with a composable filter builder (clauses stack — e.g. private AND stale-90d AND tagged "side-project"), plus a "Save as Smart Folder" shortcut.
- Delete, change visibility, or download in one pass, with live progress and honest per-item failure reporting.
- Retry Failed Only after a partial failure.
- Undo for bulk visibility changes — up to 5 actions held at once, each independently reversible for an hour. (Delete and rename are excluded — delete is permanent on GitHub's side, and rename is collision-prone, so neither is a safe undo candidate.)

**Notifications**
- A real GitHub webhook receiver (`/webhook/github`, HMAC-verified per repo) driving push/issues/PR/release/CI (`workflow_run`, terminal state only)/deployment-status alerts.
- Rapid-fire events digest into one message instead of several, via a durable Redis-backed buffer that survives a bot restart mid-window.
- Per-repo mute, independent of the global notification toggles.
- Optional quiet-hours window that holds digests rather than delivering them immediately.
- Optional daily/weekly rollup summary ("3 repos touched, 12 changes via bot, 2 pushes received").

**Settings & visibility into the bot itself**
- Live Postgres/Redis health, GitHub rate-limit budget (color-coded, read passively off headers already present on outgoing calls — no extra request spent), memory/uptime, bot version.
- Activity Log, filterable to errors-only.
- Access Log — connection history with rules-based anomaly flags (reconnect shortly after a disconnect; GitHub scope changed between sessions).
- My Defaults — saved visibility/commit-message/upload-path/sort/filter, a "learn from me" nudge when your actual usage diverges from the current default, and an old→new changelog of every default change.
- Storage & Data — see exactly what GitroHub remembers about you, clear it granularly or fully (typed confirmation required), export it, and auto-cleanup of old activity.
- Rolling 30-day size history per repo, shown as a text sparkline alongside the current prior-vs-now delta.
- `GET /health` — `200`/`ok` or `503`/`degraded` based on live Postgres + Redis reachability, meant for Railway's health check to catch a degraded instance proactively.

**Under the hood**
- GitHub API layer: passive rate-limit tracking, adaptive retry backoff that widens under a low budget, request coalescing for duplicate in-flight reads, and an ETag-conditional cache on the (expensive, frequently-hit) recursive tree fetch so an unchanged tree costs nothing against the rate limit.
- Memory-hardened for Railway's 512MB free tier: a V8 heap ceiling via `NODE_OPTIONS=--max-old-space-size=384`, a self-imposed RSS watchdog that shuts down cleanly before the kernel force-kills the process, and upload file bytes kept in a short-lived in-process cache instead of round-tripping through Redis session state.
- Telegram updates processed one at a time with pending updates dropped on boot, so a restart can't trigger a delivery burst.
- Postgres pool capped at `PG_POOL_MAX` (default 3) and GitHub API clients cached per token.
- `migrate.js` runs `schema.sql` on every boot using `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` throughout, so the schema is always current without any manual step.
