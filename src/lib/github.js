const { Octokit } = require('@octokit/rest');

/**
 * Thin wrapper around Octokit implementing every GitHub operation GitroHub's
 * menus map to. One function per bot action, so handlers stay declarative
 * and error-shaping (per our "specific errors always" rule) happens in
 * exactly one place per operation.
 *
 * Clients are cached per token instead of constructed fresh on every call —
 * building a new Octokit instance isn't free (route methods, request
 * wrappers, hooks all get rebuilt), and doing it on every single API call
 * was adding real allocation churn under load. Capped at 3 entries as a
 * defensive bound (a single-owner bot only ever really has one token, but
 * this avoids unbounded growth across reconnects with different tokens).
 */
const clientCache = new Map();
function client(token) {
  if (clientCache.has(token)) return clientCache.get(token);
  const octo = new Octokit({ auth: token });
  // Passive rate-limit capture via Octokit's own request hooks,
  // rather than threading header-capture through every single function
  // below (would mean touching 25+ call sites for the same effect).
  // Hooks fire for every request this client makes, success or failure.
  octo.hook.after('request', (response) => captureRateLimitHeaders(response.headers));
  octo.hook.error('request', (error) => {
    if (error.response) captureRateLimitHeaders(error.response.headers);
    throw error;
  });
  clientCache.set(token, octo);
  if (clientCache.size > 3) {
    clientCache.delete(clientCache.keys().next().value);
  }
  return octo;
}

/**
 * True if the error looks like a genuine rate-limit rejection (403 with
 * the specific rate-limit headers/message GitHub uses), as opposed to a
 * permissions 403 — those need very different messages.
 */
function isRateLimitError(err) {
  return !!(err && err.status === 403 && /rate limit/i.test(err.message || ''));
}

/**
 * Passive rate-limit tracking. Every Octokit response (success or
 * error) carries `x-ratelimit-remaining`/`x-ratelimit-reset` headers even
 * when nothing went wrong; capturing them here means Settings/Stats can
 * show a live budget without spending a request on getRateLimit() just to
 * display it, and withRetry can widen its backoff BEFORE actually hitting
 * a 403 wall instead of only reacting after.
 */
let lastRateLimitSeen = null; // { remaining, limit, resetAt, seenAt }

function captureRateLimitHeaders(headers) {
  if (!headers) return;
  const remaining = headers['x-ratelimit-remaining'];
  const limit = headers['x-ratelimit-limit'];
  const reset = headers['x-ratelimit-reset'];
  if (remaining == null) return;
  lastRateLimitSeen = {
    remaining: Number(remaining),
    limit: Number(limit),
    resetAt: reset ? Number(reset) * 1000 : null,
    seenAt: Date.now(),
  };
}

/** Best-effort passive read — may be null if no call has happened yet this
 * process, or stale if nothing's been called in a while. Callers wanting a
 * guaranteed-fresh number should still use getRateLimit(). */
function getLastKnownRateLimit() {
  return lastRateLimitSeen;
}

/**
 * Retries ONE time, with a short delay, for transient failures only —
 * network blips and 5xx server errors. Deliberately only used on
 * idempotent READ operations below; wrapping writes (create/delete/put)
 * would risk double-executing a mutation if the first attempt actually
 * succeeded but the response was lost in transit.
 *
 * Also races every call against a hard timeout. This matters more than it
 * might look: incoming Telegram updates are now processed one at a time
 * (see bot.js), so a single GitHub call that hangs indefinitely would
 * block every subsequent interaction — including /start — behind it.
 * Bounding every call here is what makes that serialization safe.
 *
 * A real timeout here needs more than racing a Promise.race() against the
 * request — that only stops US from waiting, it doesn't actually cancel
 * the underlying HTTP request. A slow GitHub response would keep running
 * in the background indefinitely, still holding a socket and buffers,
 * invisible to error handling — and a naive retry on top of that would
 * fire a SECOND independent request while the first is still running.
 * Every function below uses a real AbortController and passes
 * `request: { signal }` into its Octokit call(s), so a timeout genuinely
 * tears down the in-flight request instead of just giving up on waiting
 * for it.
 */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Runs fn(signal) with a real, enforced timeout — fn must pass `signal`
 * into every Octokit call it makes via `request: { signal }`, or that
 * call won't actually be cancelled when the timeout fires (it'll just
 * become an orphaned background request again, same as before). The
 * timeout error message is kept in the exact same format as the old
 * Promise.race version so nothing reading `err.message` elsewhere breaks.
 */
async function withAbortTimeout(fn, label, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adaptive backoff. When the last-seen rate-limit headers show
 * we're running low (<10 remaining), transient-error retries space out
 * proportionally to how close the reset actually is, instead of always
 * using the same flat 600ms — a flat retry delay when quota is nearly gone
 * just burns the same tiny remaining budget faster. This never SKIPS a
 * call outright (that would silently change correctness); it only widens
 * the wait before a retry of an already-transient failure.
 */
function computeRetryDelayMs() {
  const rl = lastRateLimitSeen;
  if (!rl || rl.remaining > 10 || !rl.resetAt) return 600;
  const msUntilReset = rl.resetAt - Date.now();
  if (msUntilReset <= 0) return 600;
  // Cap the widened delay so a single retry never itself becomes the thing
  // that makes the caller time out (REQUEST_TIMEOUT_MS is 15s).
  return Math.min(Math.max(msUntilReset / Math.max(rl.remaining, 1), 600), 8000);
}

/**
 * Request coalescing for READ-ONLY calls only. If two handlers
 * (e.g. Browse Files and Search Files) ask for the same repo's tree within
 * milliseconds of each other, the second attaches to the first's in-flight
 * promise instead of firing a duplicate GitHub request. Deliberately never
 * applied to writes (putFile/deleteRepo/etc.) — deduping an intentional
 * double action on a mutation would silently drop it, which is a
 * correctness bug, not an optimization.
 */
const inFlight = new Map(); // key -> Promise

function coalesce(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = Promise.resolve().then(fn);
  inFlight.set(key, p);
  p.finally(() => inFlight.delete(key));
  return p;
}

async function withRetry(fn, label = 'GitHub API request') {
  try {
    return await withAbortTimeout(fn, label);
  } catch (err) {
    const transient = (err.status >= 500 && err.status < 600) || !err.status;
    if (!transient || isRateLimitError(err)) throw err; // rate limits shouldn't be retried immediately
    await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs()));
    return withAbortTimeout(fn, `${label} (retry)`);
  }
}

async function getAuthenticatedUser(token) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.users.getAuthenticated({ request: { signal } });
    return data; // { login, avatar_url, ... }
  })(), 'Get authenticated user');
}

async function getRateLimit(token) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.rateLimit.get({ request: { signal } });
    return data.resources.core; // { limit, remaining, reset }
  })(), 'Get rate limit');
}

async function listRepos(token, { sort = 'updated', direction = 'desc' } = {}) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    return octo.paginate(octo.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort,
      direction,
      request: { signal },
    });
  })(), 'List repos');
}

async function getRepo(token, owner, repo) {
  return coalesce(`getRepo:${token}:${owner}/${repo}`, () => withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.get({ owner, repo, request: { signal } });
    return data;
  })(), 'Get repo'));
}

async function createRepo(token, { name, isPrivate, description, licenseTemplate }) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.createForAuthenticatedUser({
      name,
      private: isPrivate,
      description: description ? sanitizeDescription(description) : undefined,
      license_template: licenseTemplate || undefined,
      auto_init: true, // ensures a default branch + initial commit exist immediately
      request: { signal },
    });
    return data;
  })(), 'Create repo');
}

async function deleteRepo(token, owner, repo) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    await octo.repos.delete({ owner, repo, request: { signal } });
  })(), 'Delete repo');
}

/** Registers a webhook on a repo pointed at our /webhook/github endpoint.
 * `secret` is generated by the caller and stored alongside the webhook id
 * so incoming payloads can be verified against it later. */
async function createWebhook(token, owner, repo, callbackUrl, secret) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.createWebhook({
      owner,
      repo,
      config: { url: callbackUrl, content_type: 'json', secret },
      events: ['push', 'issues', 'pull_request', 'release', 'workflow_run', 'deployment_status'],
      request: { signal },
    });
    return data;
  })(), 'Create webhook');
}

async function deleteWebhook(token, owner, repo, webhookId) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    await octo.repos.deleteWebhook({ owner, repo, hook_id: webhookId, request: { signal } });
  })(), 'Delete webhook');
}

async function renameRepo(token, owner, repo, newName) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.update({ owner, repo, name: newName, request: { signal } });
    return data;
  })(), 'Rename repo');
}

async function setVisibility(token, owner, repo, isPrivate) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.update({ owner, repo, private: isPrivate, request: { signal } });
    return data;
  })(), 'Change visibility');
}

/** GitHub rejects repo descriptions containing control characters (e.g.
 * stray \n, \t, or other C0/C1 codes that sneak in via copy-paste from
 * Telegram). Strip them and collapse any resulting whitespace so the
 * request never 422s on this. */
function sanitizeDescription(description) {
  if (!description) return '';
  // eslint-disable-next-line no-control-regex
  return description.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function updateDescription(token, owner, repo, description) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.update({ owner, repo, description: sanitizeDescription(description), request: { signal } });
    return data;
  })(), 'Update description');
}

/** GitHub's Repos API has no "set license" field — a repo's detected
 * license comes from actually scanning a LICENSE file in the tree
 * (licensee). To change it, we fetch the real license body text from
 * GitHub's own /licenses/{key} endpoint and write/replace a LICENSE file —
 * same mechanism a person clicking "Add license" on github.com uses. */
async function getLicenseText(token, licenseKey) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.licenses.get({ license: licenseKey, request: { signal } });
    return data.body;
  })(), 'Fetch license text');
}

async function forkRepo(token, owner, repo) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.createFork({ owner, repo, request: { signal } });
    return data;
  })(), 'Fork repo');
}

/** Last N commits — used for Repo View's commit preview (#5). */
async function getRecentCommits(token, owner, repo, count = 3) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.listCommits({ owner, repo, per_page: count, request: { signal } });
    return data.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0], // first line only — commit bodies can be long
      author: c.commit.author.name,
      date: c.commit.author.date,
    }));
  })(), 'Get recent commits');
}

/** Star/unstar a repo (#6 — quick toggle on public/external repos). GitHub's
 * star endpoints return 204 No Content on success, nothing to parse. */
async function starRepo(token, owner, repo) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    await octo.activity.starRepoForAuthenticatedUser({ owner, repo, request: { signal } });
  })(), 'Star repo');
}

async function unstarRepo(token, owner, repo) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    await octo.activity.unstarRepoForAuthenticatedUser({ owner, repo, request: { signal } });
  })(), 'Unstar repo');
}

/** GitHub returns 204 if starred, 404 if not — neither is really an "error"
 * for our purposes, so this normalizes both into a plain boolean instead of
 * making every caller handle a 404 specially. */
async function isStarred(token, owner, repo) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    try {
      await octo.activity.checkRepoIsStarredByAuthenticatedUser({ owner, repo, request: { signal } });
      return true;
    } catch (err) {
      if (err.status === 404) return false;
      throw err;
    }
  })(), 'Check starred');
}

// ETag cache for the tree fetch (the most expensive, most-repeated
// read: Browse Files, file search, and the upload wizard's diff/classify
// step all hit it). A conditional request that comes back 304 doesn't count
// against rate-limit quota at all, unlike a normal request. Keyed on the
// resolved ref sha, not just owner/repo, so a stale entry can never be
// served across an actual branch update — the ref lookup itself always
// happens fresh; only the (large) recursive tree body is conditional.
const treeEtagCache = new Map(); // `${owner}/${repo}:${sha}` -> { etag, tree }

/** Fetches the full recursive git tree, unfiltered (files + folders). Shared
 * by getTree() (files-only, for Browse Files/upload change-detection) and
 * getTreeStats() (size/file/folder counts, for Repo View). */
async function getRawTree(token, owner, repo, branch = null) {
  return coalesce(`getRawTree:${token}:${owner}/${repo}:${branch || ''}`, () => withRetry((signal) => (async () => {
    const octo = client(token);
    const repoData = branch ? { default_branch: branch } : await getRepo(token, owner, repo);
    const { data: refData } = await octo.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
      request: { signal },
    });
    const sha = refData.object.sha;
    const cacheKey = `${owner}/${repo}:${sha}`;
    const cached = treeEtagCache.get(cacheKey);

    try {
      const headers = cached ? { 'If-None-Match': cached.etag } : undefined;
      const response = await octo.git.getTree({
        owner,
        repo,
        tree_sha: sha,
        recursive: 'true',
        headers,
        request: { signal },
      });
      const etag = response.headers && response.headers.etag;
      if (etag) treeEtagCache.set(cacheKey, { etag, tree: response.data.tree });
      // Defensive bound — a single-owner bot only has so many repos open at
      // once; this just stops unbounded growth if many different shas get cached.
      if (treeEtagCache.size > 50) treeEtagCache.delete(treeEtagCache.keys().next().value);
      return response.data.tree;
    } catch (err) {
      if (err.status === 304 && cached) return cached.tree; // unchanged — served from cache, zero quota cost
      throw err;
    }
  })(), 'Get file tree'));
}

/** Invalidate the tree ETag cache for a repo — call after any write that
 * changes its tree (upload, commit, delete file) so a subsequent fetch
 * can't serve a stale 304 hit against a sha we've since moved past.
 * (In practice the ref sha itself changes on any commit, which already
 * changes the cache key — this exists mainly for the delete-repo case,
 * where the same repo NAME could later be recreated with a fresh history.) */
function invalidateTreeEtag(owner, repo) {
  for (const key of treeEtagCache.keys()) {
    if (key.startsWith(`${owner}/${repo}:`)) treeEtagCache.delete(key);
  }
}

/** Full recursive file tree — used for both Browse Files and file search */
async function getTree(token, owner, repo, branch = null) {
  const tree = await getRawTree(token, owner, repo, branch);
  return tree.filter((entry) => entry.type === 'blob'); // files only
}

/**
 * Repo size/file/folder counts computed from the tree we already fetch —
 * GitHub's own `repo.size` field (KB) is a periodically-recomputed cache on
 * their end and visibly lags real changes (e.g. right after an upload), so
 * we derive the real numbers from the same tree data instead of trusting it.
 * Falls back to `null` sizeBytes for entries GitHub returns without a size
 * (only happens for very large blobs it declines to size inline) — those are
 * summed as 0 and callers should treat the total as a lower bound in that case.
 */
async function getTreeStats(token, owner, repo, branch = null) {
  const tree = await getRawTree(token, owner, repo, branch);
  let sizeBytes = 0;
  let fileCount = 0;
  let folderCount = 0;
  let sizeIncomplete = false;
  for (const entry of tree) {
    if (entry.type === 'blob') {
      fileCount++;
      if (typeof entry.size === 'number') sizeBytes += entry.size;
      else sizeIncomplete = true;
    } else if (entry.type === 'tree') {
      folderCount++;
    }
  }
  return { sizeBytes, fileCount, folderCount, sizeIncomplete };
}

/** Encodes file content to base64 for GitHub's Contents/Git Data APIs without
 * ever routing through a UTF-8 string round-trip — that round-trip is lossy
 * for arbitrary bytes (images, PDFs, zips, executables, ...), silently
 * corrupting anything that isn't valid UTF-8 text. Buffers are encoded as-is;
 * plain strings (e.g. hand-typed commit content, license text) still go
 * through Buffer.from(..., 'utf8') since those are always genuine text. */
function toBase64(content) {
  return (Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')).toString('base64');
}

/**
 * Fetches a file's raw bytes as a Buffer — NOT decoded to a string — since
 * this is used for binary files (images, etc.) as well as text. Callers that
 * know they have text (Browse Files' text preview, Edit File, README/LICENSE
 * handling) should call `.toString('utf8')` on `content` themselves.
 *
 * GitHub's Contents API only returns inline `content` for files under 1MB —
 * for anything larger it comes back with an empty/missing content field even
 * though `size` is correctly reported. Silently treating that as "empty
 * file" would be actively dangerous for callers like Edit File (could
 * overwrite a real file with near-nothing), so this throws a clear,
 * recognizable error instead of returning a corrupted result.
 */
async function getFileContent(token, owner, repo, path) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.getContent({ owner, repo, path, request: { signal } });
    if (Array.isArray(data)) throw new Error('Path is a directory, not a file');
    if (!data.content && data.size > 0) {
      throw new Error(`File is too large to fetch inline (${data.size} bytes) — GitHub's API only returns content for files under 1MB.`);
    }
    const content = Buffer.from(data.content || '', data.encoding || 'base64');
    return { content, sha: data.sha, size: data.size };
  })(), 'Get file content');
}

/**
 * Create or update a single file — one commit per call.
 * For multi-file zip uploads, use commitMultipleFiles() instead (one commit total).
 * `content` may be a Buffer (preserves binary fidelity) or a plain text string.
 */
async function putFile(token, owner, repo, path, content, message, existingSha = null) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: toBase64(content),
      sha: existingSha || undefined,
      request: { signal },
    });
    return data;
  })(), 'Update file');
}

async function deleteFile(token, owner, repo, path, sha, message) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.deleteFile({ owner, repo, path, message, sha, request: { signal } });
    return data;
  })(), 'Delete file');
}

/**
 * Commit multiple files (and optionally delete some) in ONE commit using the
 * Git Data API (blobs -> tree -> commit -> update ref). Deletions are done by
 * setting `sha: null` on that path's tree entry, which GitHub's Git Trees API
 * treats as "remove this path" when building on top of an existing base_tree.
 *
 * Given a large batch/zip can genuinely need several sequential API calls,
 * this gets a longer timeout window than the single-call operations above —
 * still bounded, just sized for what a real multi-file commit can take.
 * All calls (including the parallel blob creations) share ONE AbortController,
 * so if the 45s ceiling is hit, every still-in-flight request — not just the
 * one we happened to be awaiting — actually gets torn down together.
 */
async function commitMultipleFiles(token, owner, repo, files, message, deletions = []) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const repoData = await getRepo(token, owner, repo);
    const branch = repoData.default_branch;

    const { data: refData } = await octo.git.getRef({ owner, repo, ref: `heads/${branch}`, request: { signal } });
    const latestCommitSha = refData.object.sha;

    const { data: latestCommit } = await octo.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha,
      request: { signal },
    });
    const baseTreeSha = latestCommit.tree.sha;

    const blobs = await Promise.all(
      files.map(async (f) => {
        const { data: blob } = await octo.git.createBlob({
          owner,
          repo,
          content: toBase64(f.content),
          encoding: 'base64',
          request: { signal },
        });
        return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
      })
    );

    const deletionEntries = deletions.map((path) => ({ path, mode: '100644', type: 'blob', sha: null }));

    const { data: newTree } = await octo.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: [...blobs, ...deletionEntries],
      request: { signal },
    });

    const { data: newCommit } = await octo.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [latestCommitSha],
      request: { signal },
    });

    await octo.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha, request: { signal } });

    return newCommit;
  })(), 'Commit files', 45000);
}

/** Codeload zip URL — kept for reference/fallback links in error messages only */
function zipDownloadUrl(owner, repo, branch = 'main') {
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
}

/**
 * Downloads a repo archive as a Buffer using the authenticated Git Archive API.
 * Unlike a plain fetch() against github.com/.../archive/...zip (which returns a
 * 9-byte "Not Found" for any private repo since it isn't authenticated), this
 * goes through Octokit with the user's token and works for private AND public repos.
 */
async function downloadZip(token, owner, repo, ref) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const response = await octo.repos.downloadZipballArchive({ owner, repo, ref, request: { signal } });
    return Buffer.from(response.data);
  })(), 'Download zip');
}

/** Fetches per-language byte counts (used to compute language % breakdown) */
async function getLanguages(token, owner, repo) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.listLanguages({ owner, repo, request: { signal } });
    return data; // { JavaScript: 12345, HTML: 6789, ... } bytes per language
  })(), 'Get languages');
}

module.exports = {
  getAuthenticatedUser,
  getRateLimit,
  listRepos,
  getRepo,
  createRepo,
  deleteRepo,
  createWebhook,
  deleteWebhook,
  renameRepo,
  setVisibility,
  updateDescription,
  getLicenseText,
  forkRepo,
  getRecentCommits,
  starRepo,
  unstarRepo,
  isStarred,
  getTree,
  getTreeStats,
  getFileContent,
  putFile,
  deleteFile,
  commitMultipleFiles,
  zipDownloadUrl,
  downloadZip,
  getLanguages,
  isRateLimitError,
  getLastKnownRateLimit,
  invalidateTreeEtag,
};
