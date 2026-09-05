<div align="center">

<img src="https://raw.githubusercontent.com/bonifacenjuguna/gitrohub/main/public/logo.png" width="140" alt="GitroHub logo" />

<h1>GitroHub</h1>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=20&pause=1000&color=3B82F6&center=true&vCenter=true&width=460&lines=GitHub+from+Telegram;Create+%C2%B7+Upload+%C2%B7+Download+%C2%B7+Manage;Owner-only+%C2%B7+No+one+else+gets+in;Built+with+Telegraf.js+%2B+Octokit" alt="Typing SVG" />

<p>
<img src="https://img.shields.io/badge/version-0.7.3-3B82F6?style=for-the-badge" />
<img src="https://img.shields.io/badge/node-%3E%3D18-3B82F6?style=for-the-badge&logo=node.js&logoColor=white" />
<img src="https://img.shields.io/badge/JavaScript-No%20TypeScript-F1E05A?style=for-the-badge&logo=javascript&logoColor=black" />
<img src="https://img.shields.io/badge/hosted%20on-Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" />
<img src="https://img.shields.io/badge/license-MIT-38BDF8?style=for-the-badge" />
</p>

</div>

---

## What is GitroHub?

GitroHub is a **private, owner-only Telegram bot** that connects to your GitHub account and lets you create, browse, edit, upload to, and delete repositories — all from a Telegram chat, on your phone, without opening a browser.

This isn't a public bot. It's built to talk to **exactly one person** (you) — the number in `OWNER_ID`. Everyone else who messages it is silently ignored, no reply, no logging, no processing, ever.

---

## ✨ Features

| | |
|---|---|
| 🔗 **OAuth Web Flow** | Tap once → browser opens → authorize → auto-redirected back with an animated confirmation page |
| 📁 **Repo Management** | List, filter, sort, search (fuzzy + weighted), create, rename, delete, toggle visibility |
| ⬆️ **Upload** | Single file or `.zip` (auto-strips the GitHub-style wrapper folder), with 🆕 New / ✏️ Modified / ➖ Unchanged detection before committing |
| 📂 **Browse Files** | Full tree navigation, view content, send as file, edit inline, delete |
| ⬇️ **Download** | Any of your repos, or any public external repo pasted as a link |
| 🍴 **Fork** | Fork any public GitHub repo straight into your account, with the original source shown on the card |
| ⭐ **Star / Unstar** | Toggle directly from Search's external-repo screen |
| ⚙️ **Settings** | Live Postgres/Redis health, GitHub rate-limit budget (color-coded), memory/uptime, bot version |
| 📜 **Activity Log** | Every action recorded, filterable to errors-only |
| 🔑 **Access Log** | Security-focused connection history, with rules-based anomaly flags, separate from general Activity |
| 🔔 **Notifications** | Granular on/off per category, plus a real GitHub webhook receiver — pushes, issues, PRs, CI (`workflow_run`), and deployment status — digested so rapid-fire events batch into one message instead of several |
| 🎨 **Animated OAuth Page** | Custom callback page with particle background, circuit-line animation, live status feed, and a countdown auto-redirect back into Telegram |
| 📌 **Pinned Repos** | Manual quick-access list, grouped into named sections, with drag-style reorder (⬆️⬇️) scoped within each section |
| 🏷️ **Tags** | Your own labels across repos, with nesting (e.g. "Work" → "Work/Client-A"), a fixed 6-color palette, optional auto-rules, and per-tag defaults for visibility/upload-path/commit-message |
| 🗂️ **Smart Folders** | Save a composable filter (visibility + language + staleness + tag + name) as a named quick-access view |
| 🧹 **Bulk Repo Actions** | Multi-select repos with a composable filter builder (clauses stack, e.g. private AND stale-90d AND tagged "side-project"), delete/visibility/download in one pass, live progress, honest per-item failure reporting, retry-failed-only, and one-tap undo for visibility changes (up to 5 actions, each independently reversible for an hour) |
| 📥 **Batch Upload** | Collect several loose files before committing — one combined commit, one combined New/Modified/Unchanged summary |
| 🔁 **Replace** | Swap a single file's content by sending a new file (not retyping), or fully sync a folder (add/update/delete) with an explicit before-you-commit delete preview |
| ⬆️ **Upload Here** | Upload directly into whatever folder you're currently browsing, path pre-filled |
| ⚙️ **My Defaults** | Saved visibility/commit-message/upload-path/sort/filter defaults, with a "learn from me" pattern nudge and a changelog of every default change (old → new) |
| 📦 **Storage & Data** | See what GitroHub remembers about you, clear it granularly (or fully, with a typed confirmation), export it, and auto-cleanup old activity |
| 🕓 **Recently Viewed & Search History** | Quick-tap shortcuts back to repos you actually opened or searched for, each clearable independently |
| 📊 **Stats & Size History** | A rolling 30-day size trend as a text sparkline, alongside the current prior-vs-now delta |
| 🧾 **Rollup Digests** | Optional daily/weekly summary ("3 repos touched, 12 changes via bot, 2 pushes received") plus an optional quiet-hours window that holds webhook digests rather than delivering them immediately |

---

## 🏗️ Architecture

```
┌─────────────────┐        ┌──────────────────────┐
│   Telegram       │◄──────►│   bot.js (Telegraf)   │
│   (You, only)    │        │   Owner gate → Scenes │
└─────────────────┘        └──────────┬────────────┘
                                       │
                     ┌─────────────────┼─────────────────┐
                     ▼                 ▼                 ▼
              ┌────────────┐   ┌─────────────┐   ┌──────────────┐
              │  Postgres   │   │    Redis     │   │  GitHub API   │
              │ users, logs │   │ sessions,    │   │ (Octokit)     │
              │             │   │ wizard state │   │              │
              └────────────┘   └─────────────┘   └──────────────┘
                                       ▲
                                       │
                     ┌─────────────────┴─────────────────┐
                     │   app.js (Express) — /callback      │
                     │   /webhook/github — live GitHub      │
                     │   event receiver (HMAC-verified)     │
                     │   Animated OAuth confirmation page   │
                     └──────────────────────────────────────┘
```

**One process, two jobs**: the same Node process runs both the Telegraf bot (webhook or polling) and a small Express server that handles GitHub's OAuth redirect (`/callback`), serves the animated confirmation page, and receives live GitHub webhook events (`/webhook/github`). This keeps Railway hosting to a single service.

### Folder structure

```
gitrohub/
├── public/
│   ├── logo.png              # Bot logo (transparent PNG)
│   └── callback.html         # Animated OAuth callback page
├── src/
│   ├── index.js               # Entrypoint — boots DB, Redis, bot, server
│   ├── bot.js                 # Telegraf wiring: middleware, scenes, routers
│   ├── config.js               # Env var loading + validation
│   ├── db/
│   │   ├── postgres.js         # Pool + ping()
│   │   ├── redis.js            # Client + ping()
│   │   ├── schema.sql          # Full schema — users, activity_log, tags, pins,
│   │   │                       #   defaults, webhooks, snapshots, and more
│   │   └── migrate.js          # Runs schema.sql on boot (safe to re-run)
│   ├── lib/
│   │   ├── github.js           # Octokit wrapper — every GitHub operation,
│   │   │                       #   with rate-limit tracking, adaptive backoff,
│   │   │                       #   read coalescing, and ETag-cached tree fetches
│   │   ├── oauth.js            # Authorize URL + code exchange
│   │   ├── users.js            # Account data-access (connect/disconnect)
│   │   ├── crypto.js           # AES-256-GCM token encryption
│   │   ├── gitHash.js          # Git blob SHA (for upload change-detection)
│   │   ├── activity.js         # Activity log read/write
│   │   ├── accessLog.js        # Access log + anomaly flags
│   │   ├── actionLock.js       # Per-action double-tap protection
│   │   ├── confirmFlow.js      # Shared confirm/cancel-in-place helper
│   │   ├── format.js           # Locked formatting standard (see below)
│   │   ├── requireConnected.js # Guard used by every GitHub-touching handler
│   │   ├── pins.js             # Pinned repos + sections
│   │   ├── tags.js             # Tags, nesting, auto-rules, per-tag defaults
│   │   ├── defaults.js         # My Defaults resolution (tag override → global)
│   │   ├── pathMemory.js       # Remembered upload paths, per-repo and global
│   │   ├── dataStore.js        # Storage & Data screen backing logic
│   │   ├── searchHistory.js    # Recent searches
│   │   ├── recentlyViewed.js   # Recently opened repos
│   │   ├── searchRanking.js    # Fuzzy + weighted result ranking
│   │   ├── filterClauses.js    # Shared filter engine (Smart Folders + Bulk)
│   │   ├── bulkUndo.js         # Reversible bulk-action ledger
│   │   ├── renameCascade.js    # Keeps tags/pins/mutes/webhooks bound through a rename
│   │   ├── repoWebhooks.js     # Per-repo live GitHub webhook registration
│   │   ├── webhookDigest.js    # Buffers and batches rapid-fire webhook events
│   │   ├── notificationMutes.js
│   │   ├── sizeSnapshot.js     # Rolling size history + sparkline
│   │   ├── rollup.js           # Daily/weekly digest + quiet hours
│   │   ├── repoCache.js        # Per-token Octokit client caching
│   │   ├── fileBufferCache.js  # Short-lived in-process cache for upload bytes
│   │   ├── concurrency.js      # Coalesces duplicate in-flight reads
│   │   └── errorHelpers.js
│   ├── middleware/
│   │   ├── ownerGate.js        # Silently drops all non-owner traffic
│   │   └── redisSessionStore.js
│   ├── keyboards/
│   │   ├── bbtb.js             # Reply keyboards (Buttons Below Typing Bar)
│   │   ├── inline.js           # Inline keyboards
│   │   └── buttonStyle.js      # Outcome-based button color system
│   ├── handlers/                # One file per screen/zone
│   └── scenes/                  # Multi-step wizards (Create/Upload/Rename/Edit)
├── package.json
├── .env.example
├── README.md
└── CHANGELOG.md
```

---

## 🧠 Memory & stability (Railway free tier)

Railway's free/trial tier caps each service at **512MB RAM**. Node's V8 engine doesn't know that by default — it sizes its heap based on what it *thinks* the machine has, so without help it can grow past the container's real limit and get hard-killed by the kernel (`Killed` in the logs, no stack trace, since Node never gets a chance to log anything).

GitroHub defends against this on three layers:

1. **`--max-old-space-size=384`** (set via the `NODE_OPTIONS` environment variable — see `.env.example`) forces V8 to respect a real ceiling and garbage-collect proactively, instead of growing unchecked. Leaves ~128MB headroom under the 512MB limit for buffers and native overhead that live outside V8's heap.
2. **A self-imposed RSS watchdog** (`MEMORY_WATCHDOG_MB`, default 400) checks actual memory every 30s and triggers a *clean* shutdown — closing Postgres and Redis properly — before the kernel ever needs to force-kill it. Railway restarts either way; this just avoids any risk of a write getting cut off mid-flight.
3. **File content never round-trips through Redis.** Raw upload bytes live in a short-lived in-process cache (`lib/fileBufferCache.js`); only a lightweight reference goes into session state, keeping the Telegraf wizard state small even for near-1MB zip uploads.

Also: the Postgres pool is capped at `PG_POOL_MAX` (default 3) — a single-owner bot doesn't need more — and GitHub API clients are cached per token instead of being constructed fresh on every call. Telegram updates are processed one at a time with `drop_pending_updates` on boot, so a restart never triggers a delivery burst that could spike memory on its own.

### `GET /health`
Returns `200` with `{ status: "ok", postgres, redis, memoryMB, uptimeSeconds }` when healthy, `503` with `status: "degraded"` if either DB is unreachable. Point Railway's health check at this path so it can restart a degraded instance proactively.

---

## 📋 Changelog

See **[CHANGELOG.md](./CHANGELOG.md)** for the full, itemized feature list of this release.

---

## 🚀 Setup

### 1. Create the Telegram bot
Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow the prompts → copy the token.

### 2. Get your Telegram user ID
Message [@userinfobot](https://t.me/userinfobot) → copy your numeric ID. This becomes `OWNER_ID` — the **only** ID the bot will ever respond to.

### 3. Create a GitHub OAuth App
Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**:
- **Homepage URL**: your Railway URL (e.g. `https://gitrohub-production.up.railway.app`)
- **Authorization callback URL**: `https://your-railway-url.up.railway.app/callback` *(must match exactly, no trailing slash)*

Copy the **Client ID** and generate a **Client Secret**.

### 4. Set up Railway
1. Create a new Railway project, deploy from this repo (or upload the zip)
2. Add a **Postgres** plugin — copies `DATABASE_URL` into your environment automatically
3. Add a **Redis** plugin — copies `REDIS_URL` into your environment automatically
4. Set the remaining environment variables (copy `.env.example` → fill in):

```
BOT_TOKEN=...
OWNER_ID=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
BASE_URL=https://your-railway-url.up.railway.app
SESSION_JWT_SECRET=$(openssl rand -hex 32)
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)
NODE_OPTIONS=--max-old-space-size=384
NODE_ENV=production
```

5. Deploy. On boot, GitroHub automatically:
   - Runs the Postgres migration (creates all tables — safe to re-run)
   - Connects to Redis
   - Registers the Telegram webhook pointing at `${BASE_URL}/telegram-webhook`
   - Starts the Express server for `/callback` and `/webhook/github`

### 5. Local development (optional)
```bash
npm install
cp .env.example .env   # fill in your values, leave NODE_ENV unset
npm run dev             # runs in long-polling mode, no webhook needed
```
In dev mode the bot polls Telegram directly, so `BASE_URL` only needs to be reachable for the `/callback` route — use a tool like `ngrok http 3000` and point your GitHub OAuth App + `.env`'s `BASE_URL` at the ngrok URL.

### 6. Talk to your bot
Open your bot on Telegram, hit `/start`, tap **Connect GitHub Account** — you'll get the animated callback page, then land back in the bot fully connected.

---

## 🎨 The animated OAuth callback page

`public/callback.html` is a single self-contained file (no build step, no framework) featuring:
- A canvas-based particle field + circuit-line background with a traveling signal pulse
- A slowly rotating conic gradient glow behind the card
- A terminal-style status feed that plays out step-by-step with SVG checkmarks/X's (no emoji — Lucide-style hand-drawn stroke icons)
- A live SVG countdown ring that auto-redirects back into Telegram (deep link) when it hits zero
- Distinct color themes for success (blue → green) and failure (blue → red) states
- The GitroHub logo, loaded from the raw GitHub URL (`https://raw.githubusercontent.com/bonifacenjuguna/gitrohub/main/public/logo.png`) rather than served locally — renders correctly even if `public/` ever isn't deployed alongside `src/`, and works when opening `callback.html` directly as a local file too

The bot's `app.js` injects `window.__GITROHUB__` with the real outcome (`success`/`error`, GitHub username, and — on failure — exactly which step failed) so the page always reflects what actually happened, never a generic animation.

---

## 🔒 Security notes

- **Owner gate is the first middleware registered**, before session lookup, before anything — non-owner messages are dropped with zero processing, zero reply, zero log noise.
- GitHub access tokens are encrypted at rest with **AES-256-GCM** (`TOKEN_ENCRYPTION_KEY`) before being stored in Postgres — never stored in plaintext.
- OAuth `state` parameter is a short-lived **signed JWT** carrying your Telegram ID, so the `/callback` route can't be spoofed into linking a token to the wrong chat.
- OAuth scope requested is `repo` only — full control of repositories, nothing broader (no `admin:org`, no `user` scope, etc.).
- The GitHub webhook receiver (`/webhook/github`) verifies every incoming event against `X-Hub-Signature-256` using a per-repo secret before processing anything.
- Disconnecting your account tears down any live GitHub webhooks registered by the bot before the token is wiped, so nothing keeps running on your GitHub repo settings afterward.

---

## 📐 Design principles baked into the code

These apply everywhere in the codebase:

1. **BBTB vs Inline** — reusable/frequent actions live in the Reply Keyboard (bottom bar); content-specific and destructive/final actions live inline, attached to the message.
2. **Every error names the exact cause + next step** — see `format.errorMessage()`, used everywhere instead of generic "Something went wrong" messages.
3. **State-based emoji/labels are never stale** — visibility, language, filter/sort labels are recomputed fresh on every render.
4. **Edit in place within a flow, send fresh on final/destructive outcomes** — so multi-step wizards don't spam the chat, but a completed action always leaves a permanent record.
5. **⬅️ Back ≠ restart** — wizard state lives in Redis (`SESSION_TTL_SECONDS`, default 24h), so backing up a step preserves what you already typed, and a Railway restart mid-flow doesn't wipe your progress.
6. **Nothing applies silently** — learned suggestions (default upload path, tag assignment on creation) always offer a one-tap confirmation rather than changing your settings on their own.

---

## ⚠️ Known limitations

Being upfront about what's simplified, consistent with the "specific errors, not vague ones" principle applied to the docs too:

- **"Browse Folders" during single-file upload path selection** falls back to type-path (with the repo's current structure shown for context, a one-tap Root shortcut, and remembered-path suggestions) — the folder-tap navigator is scoped to browsing an *existing* tree (Browse Files), which is fully implemented, including pagination.
- **🟢🟡🔴 Activity Status indicator** exists on repo cards, but a **🍴 "Forked from X" tag** on list screens is deferred — the list endpoint doesn't include the parent-repo field, and fetching it per-row would mean one extra API call per visible repo just for a badge. Repo View itself does show the real source for forks.
- **Text/slash-command fallback** for repo actions (e.g. `/repos`) isn't implemented — `/start`, `/settings`, `/cancel` exist as commands, but the button-driven UI is the primary interface for everything else.

None of these block normal daily use.

---

## 💡 Recommendations for what's next

A few things worth considering, beyond what's shipped in this release:

1. **Large repo tree pagination** — `getTree()` fetches the *entire* recursive tree in one call, which is fine up to a few thousand files, but very large repos (10k+ files) could hit response-size or Telegram-message-size limits in Browse Files. Worth capping and paginating server-side, not just visually.
2. **Structured logging** — `console.log`/`console.error` is fine for a single-user bot on Railway's log viewer, but if this ever grows, swapping in a tiny structured logger (pino is lightweight and pairs well with Railway's log parsing) would make the Settings → Activity error surfacing more powerful.
3. **Line-level diff preview** for `replaceFolder` uploads, resumable zip uploads across a restart, README MarkdownV2 rendering, repo templates, and a unified Quick Access panel merging Recently Viewed/Search History/Pinned are all real, separable pieces of work — held back deliberately from this release rather than shipped half-done.

---

<div align="center">
<sub>Built for one person, on purpose. 🔒</sub>
</div>
