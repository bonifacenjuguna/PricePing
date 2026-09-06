const config = require('../config');
const settingsDb = require('../db/settings');

// Bot Modes — one multiplier scales BOTH alert sensitivity (threshold) and
// automation cadence (chart/movers/F&G intervals) in the same direction.
// A smaller multiplier = tighter threshold = more frequent alerts = faster
// automation. Anti-Spam additionally applies a hard daily post cap and
// skips Movers automation entirely (see automationScheduler.js) — that's
// the "extra restrictions" on top of its 2x multiplier.
const MODE_DEFS = {
  nitro: { key: 'nitro', label: '🏎️ Nitro', description: 'Ultra fast — ¼x threshold, ¼x intervals', multiplier: 0.25 },
  turbo: { key: 'turbo', label: '🚀 Turbo', description: 'Fast — ½x threshold, ½x intervals', multiplier: 0.5 },
  cruise: { key: 'cruise', label: '🛣️ Cruise', description: 'Normal — actual default threshold/intervals', multiplier: 1 },
  anti_spam: {
    key: 'anti_spam',
    label: '🐢 Anti-Spam',
    description: 'Slow — 2x threshold/intervals, daily post cap, no Movers',
    multiplier: 2,
    extraRestrictions: true,
  },
};

const MODE_ORDER = ['nitro', 'turbo', 'cruise', 'anti_spam'];

async function getCurrentModeKey() {
  const stored = await settingsDb.get('bot_mode');
  if (stored && MODE_DEFS[stored]) return stored;
  return MODE_DEFS[config.defaultBotMode] ? config.defaultBotMode : 'cruise';
}

async function getCurrentMode() {
  const key = await getCurrentModeKey();
  return MODE_DEFS[key];
}

async function setMode(key) {
  if (!MODE_DEFS[key]) throw new Error(`Unknown mode: ${key}`);
  await settingsDb.set('bot_mode', key);
  return MODE_DEFS[key];
}

function isAntiSpam(modeKey) {
  return MODE_DEFS[modeKey] && MODE_DEFS[modeKey].extraRestrictions === true;
}

module.exports = { MODE_DEFS, MODE_ORDER, getCurrentModeKey, getCurrentMode, setMode, isAntiSpam };
