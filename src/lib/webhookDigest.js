const redisDb = require('../db/redis');

const DIGEST_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const DUE_KEY_PREFIX = 'webhook-digest-due:';
const BUFFER_KEY_PREFIX = 'webhook-buffer:';

function bufferKey(telegramId, repo) {
  return `${BUFFER_KEY_PREFIX}${telegramId}:${repo}`;
}
function dueKey(telegramId, repo) {
  return `${DUE_KEY_PREFIX}${telegramId}:${repo}`;
}

/**
 * Batches rapid-fire webhook events (e.g. 5 pushes in 2 minutes)
 * into one Telegram message instead of one message per event. Uses a
 * Redis LIST for the buffer (append-only, cheap) and a separate TTL "due"
 * marker key rather than a JS setTimeout — a setTimeout would be lost on
 * any restart (deploy, memory-watchdog cycle), silently dropping whatever
 * was mid-buffer. The due marker survives a restart because it's just
 * data; a lightweight poller (piggybacked on the existing memory-watchdog
 * interval — see bot.js) scans for markers whose TTL has expired and
 * flushes them.
 *
 * Returns true if this is the FIRST event in a fresh window (caller uses
 * this to know whether a flush needs scheduling — it already does, since
 * the poller scans unconditionally, but kept for clarity/future use).
 */
async function push(telegramId, repo, summary) {
  const key = bufferKey(telegramId, repo);
  await redisDb.client.rPush(key, JSON.stringify({ summary, at: Date.now() }));

  const due = dueKey(telegramId, repo);
  const exists = await redisDb.client.exists(due);
  if (!exists) {
    // Marks when this window's flush becomes due. The key's VALUE is
    // unused (just a marker); its existence + no-TTL-yet is checked via a
    // separate scan pattern below, since Redis can't natively "list keys
    // about to expire" — instead we store the due timestamp as the value
    // and compare on scan, which also survives clock drift better than
    // relying on TTL expiry timing exactly.
    await redisDb.client.set(due, String(Date.now() + DIGEST_WINDOW_MS));
    return true;
  }
  return false;
}

/** Scans for any due digest windows and returns their (telegramId, repo)
 * pairs along with the buffered events, THEN clears both keys. Called by
 * the poller — see bot.js's memory-watchdog-adjacent interval. */
async function flushDue() {
  const dueKeys = await redisDb.client.keys(`${DUE_KEY_PREFIX}*`);
  const results = [];
  const now = Date.now();

  for (const key of dueKeys) {
    const dueAt = Number(await redisDb.client.get(key));
    if (!dueAt || dueAt > now) continue; // not due yet

    const rest = key.slice(DUE_KEY_PREFIX.length);
    const sepIdx = rest.indexOf(':');
    const telegramId = rest.slice(0, sepIdx);
    const repo = rest.slice(sepIdx + 1);

    const bKey = bufferKey(telegramId, repo);
    const raw = await redisDb.client.lRange(bKey, 0, -1);
    await redisDb.client.del(bKey, key);

    if (raw.length > 0) {
      results.push({ telegramId: Number(telegramId), repo, events: raw.map((r) => JSON.parse(r)) });
    }
  }
  return results;
}

/** Composes one summary line for a digest, grouping identical summaries
 * (e.g. 5x "1 new commit pushed" -> "5 pushes"). */
function composeDigestMessage(repo, events) {
  const counts = new Map();
  for (const e of events) counts.set(e.summary, (counts.get(e.summary) || 0) + 1);
  const parts = [...counts.entries()].map(([summary, count]) => (count > 1 ? `${count}× ${summary}` : summary));
  return `🔔 ${parts.join(', ')} → ${repo}`;
}

module.exports = { push, flushDue, composeDigestMessage, DIGEST_WINDOW_MS };
