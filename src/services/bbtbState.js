// Tracks which persistent bottom keyboard (BBTB) layout is currently
// showing, so text.js only sends a keyboard-swap message on an actual
// transition (not on every repeated tap of the same button). Single-admin
// bot, module-level variable is enough — see pendingInput.js/
// wizardState.js for the same rationale.
let current = 'default';

function get() {
  return current;
}
function set(context) {
  current = context;
}

module.exports = { get, set };
