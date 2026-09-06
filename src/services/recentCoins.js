// In-memory "recently used" tracking for picker screens. Single-admin,
// single-process bot, so module-level state is fine — doesn't need to
// survive a restart, it's a UI convenience, not real state.
const MAX_RECENT = 5;
let recentSymbols = [];
let lastTestDestination = null; // channel name, or 'preview'

function noteCoin(symbol) {
  recentSymbols = [symbol, ...recentSymbols.filter((s) => s !== symbol)].slice(0, MAX_RECENT);
}

function getRecent() {
  return recentSymbols;
}

function noteTestDestination(dest) {
  lastTestDestination = dest;
}

function getLastTestDestination() {
  return lastTestDestination;
}

module.exports = { noteCoin, getRecent, noteTestDestination, getLastTestDestination };
