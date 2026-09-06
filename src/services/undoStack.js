// Generic "undo the last thing I did" mechanism — replaces the old
// threshold-only undo from v0.3.0. Single-admin bot, so an in-memory stack
// is enough; doesn't need to survive a restart (if the process restarts
// mid-undo-window, the admin just re-does it manually — same tradeoff as
// pendingInput.js).
//
// Not every mutation pushes an undo entry — only "exact value" commands and
// destructive deletes (channel remove, schedule/rule remove, caption
// reset). The ± adjustment buttons don't, since they redraw the screen
// they're on and a stray "Undo" button there would just be noise for what
// is by definition an easily-repeatable single-step nudge.
const eventsDb = require('../db/events');

const MAX_ENTRIES = 8;
const TTL_MS = 15 * 60 * 1000; // an undo button older than this is more likely to confuse than help

let nextId = 1;
let entries = []; // [{ id, label, undoFn, createdAt }]

function push(label, undoFn) {
  const id = nextId++;
  entries.push({ id, label, undoFn, createdAt: Date.now() });
  if (entries.length > MAX_ENTRIES) entries.shift();
  // Every undo-able action is by definition a meaningful config change —
  // piggybacking the audit trail here covers threshold/milestone/cooldown
  // edits, channel removal, caption changes, and schedule/rule removal in
  // one place instead of instrumenting each mutation site separately.
  eventsDb.recordAudit(label).catch(() => {});
  return id;
}

function get(id) {
  const entry = entries.find((e) => e.id === Number(id));
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) return null;
  return entry;
}

function consume(id) {
  const entry = get(id);
  if (!entry) return null;
  entries = entries.filter((e) => e.id !== Number(id));
  return entry;
}

module.exports = { push, get, consume };
