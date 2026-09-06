// Tiny in-memory multi-step wizard state, for button-driven flows whose
// accumulated choices are too many/too long to safely round-trip through
// Telegram's 64-byte callback_data limit (e.g. building a rule: trigger
// type + coin + direction + min% + action type + action-specific params).
// Each button tap updates one field here and re-renders the next screen;
// callback_data only ever carries that single step's short value, never
// the whole accumulated state.
//
// Single-admin, single-process bot (see pendingInput.js for the same
// rationale) — a module-level variable is enough, and it doesn't need to
// survive a restart. Only one wizard flow is ever in progress at a time;
// starting a new one discards whatever was in progress before.
let state = null;

const TIMEOUT_MS = 15 * 60 * 1000;

// kind: string key, e.g. 'rule' — namespaces this from any future wizard
// initial: seed fields (used when editing something that already exists)
function start(kind, initial = {}) {
  state = { kind, data: { ...initial }, startedAt: Date.now() };
  return state.data;
}

function get(kind) {
  if (!state || state.kind !== kind) return null;
  if (Date.now() - state.startedAt > TIMEOUT_MS) {
    state = null;
    return null;
  }
  return state.data;
}

function update(kind, patch) {
  const data = get(kind);
  if (!data) return null;
  Object.assign(data, patch);
  return data;
}

function clear() {
  state = null;
}

module.exports = { start, get, update, clear };
