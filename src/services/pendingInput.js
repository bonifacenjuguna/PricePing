// Tiny in-memory "what free-text input is the admin about to send" state
// machine. Single-admin, single-process bot, so a module-level variable is
// sufficient — this deliberately does NOT need to survive a restart (if
// the process restarts mid-flow, the admin just taps the button again).
//
// Used for the handful of things buttons genuinely can't capture (a hex
// color, a chat ID, a caption template, a free-form broadcast message): a
// button sets a pending action + short help text, text.js checks this
// before anything else, and whatever comes back is routed to the matching
// handler in commands.js, then cleared either way.
let pending = null;

const TIMEOUT_MS = 5 * 60 * 1000;

// action: string key, e.g. 'addcoin', 'setcaption', 'broadcast'
// context: anything the handler needs alongside the text, e.g. { alertType: 'threshold' }
// prompt: the text shown to the admin explaining what to send
function set(action, context, prompt) {
  pending = { action, context: context || {}, prompt, setAt: Date.now() };
  return pending;
}

function get() {
  if (!pending) return null;
  if (Date.now() - pending.setAt > TIMEOUT_MS) {
    pending = null;
    return null;
  }
  return pending;
}

function clear() {
  pending = null;
}

module.exports = { set, get, clear };
