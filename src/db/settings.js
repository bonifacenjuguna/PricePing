const { pool } = require('./pool');

async function get(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

async function remove(key) {
  await pool.query('DELETE FROM settings WHERE key = $1', [key]);
}

async function isPaused() {
  const val = await get('paused');
  return val === 'true';
}

async function setPaused(paused) {
  await set('paused', paused ? 'true' : 'false');
  if (paused === false) await remove('paused_until'); // resuming clears any pending snooze
}

// Global snooze: /pause 2h sets both paused=true and a wake time. The poller
// checks this every tick and auto-resumes once it passes — see poller.js.
async function getPausedUntil() {
  const val = await get('paused_until');
  return val ? new Date(val) : null;
}

async function setPausedUntil(date) {
  await set('paused', 'true');
  await set('paused_until', date.toISOString());
}

async function isAnnouncementSent() {
  const val = await get('announcement_sent');
  return val === 'true';
}

async function markAnnouncementSent() {
  await set('announcement_sent', 'true');
}

async function getSecondaryChannelId() {
  return get('secondary_channel_id');
}

async function setSecondaryChannelId(channelId) {
  if (!channelId) return remove('secondary_channel_id');
  return set('secondary_channel_id', channelId);
}

async function getLastDigestDate() {
  return get('last_digest_date');
}

async function setLastDigestDate(dateStr) {
  return set('last_digest_date', dateStr);
}

// Up to 3 shortcut keys shown as an extra row on Home — see
// views/menu.js's PINNABLE_ACTIONS catalog for the fixed set of choices.
// Defaults to a sensible starter set rather than empty, since Post/Movers/
// Test now sit one tap deeper (under Publish/Markets/Safety) than they
// used to on the flat pre-v0.9.0 layout — still explicitly overridable via
// Settings → Quick actions.
const DEFAULT_PINNED_ACTIONS = ['postmenu', 'movers', 'test'];
async function getPinnedActions() {
  const raw = await get('pinned_actions');
  if (!raw) return DEFAULT_PINNED_ACTIONS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_PINNED_ACTIONS;
  } catch {
    return DEFAULT_PINNED_ACTIONS;
  }
}

async function setPinnedActions(keys) {
  return set('pinned_actions', JSON.stringify(keys.slice(0, 3)));
}

// Kill switch: snapshot the current pause state before force-pausing
// everything, so a second tap can restore exactly what was running
// before — including per-coin mutes, not just the global pause flag.
async function getKillSnapshot() {
  const raw = await get('kill_snapshot');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function setKillSnapshot(snapshot) {
  return set('kill_snapshot', JSON.stringify(snapshot));
}
async function clearKillSnapshot() {
  return remove('kill_snapshot');
}

// Quiet hours (UTC hour-of-day window, e.g. 0-7 for "don't post between
// midnight and 7am") — checked by poller.js and automationScheduler.js.
// Digest schedules are exempt (they're already scheduled for a specific
// hour the admin chose on purpose).
async function getQuietHours() {
  const raw = await get('quiet_hours');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function setQuietHours(startHourUtc, endHourUtc) {
  return set('quiet_hours', JSON.stringify({ startHourUtc, endHourUtc }));
}
async function clearQuietHours() {
  return remove('quiet_hours');
}

// Admin's local timezone (IANA name, e.g. "Africa/Lagos") — used to
// convert /schedule and /quiethours between what's typed/displayed
// (local time) and what's stored (UTC, see utils/timezone.js). Defaults
// to UTC so existing behavior is unchanged until explicitly set.
async function getTimezone() {
  const raw = await get('timezone');
  return raw || 'UTC';
}
async function setTimezone(tz) {
  return set('timezone', tz);
}

// Hourly-alert-cap notification dedup — DB-backed specifically so a
// redeploy (which happens often; this bot's config is a plain zip upload,
// not a long-running unchanged process) doesn't reset an in-memory flag
// and cause the "cap reached" warning to refire mid-episode just because
// the process restarted. See poller.js.
async function getLastCapNotifiedAt() {
  const raw = await get('last_cap_notified_at');
  return raw ? new Date(raw) : null;
}
async function setLastCapNotifiedAt(date) {
  return set('last_cap_notified_at', date.toISOString());
}

// Compact card style — a smaller card (no logo circle, no subtitle) for
// channels that want less visual noise. Global toggle, not per-channel.
async function getCompactCards() {
  return (await get('compact_cards')) === 'true';
}
async function setCompactCards(enabled) {
  return set('compact_cards', enabled ? 'true' : 'false');
}

// Auto-sync against Binance's full spot symbol list (see
// services/coinSync.js). Off by default — this is an opt-in feature since
// it changes the tracked coin list without a human confirming each one.
// intervalHours: how often the periodic job is allowed to run.
// maxNewPerRun/maxRemovePerRun: caps so one run can't flood the coin list
// (or empty it) in a single pass — growth/cleanup happens gradually.
const DEFAULT_AUTOSYNC = {
  enabled: false,
  quoteAsset: 'USDT',
  maxNewPerRun: 5,
  maxRemovePerRun: 5,
  intervalHours: 24,
  lastRunAt: null,
};
async function getAutoSyncConfig() {
  const raw = await get('autosync_config');
  if (!raw) return { ...DEFAULT_AUTOSYNC };
  try {
    return { ...DEFAULT_AUTOSYNC, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AUTOSYNC };
  }
}
async function setAutoSyncConfig(partial) {
  const current = await getAutoSyncConfig();
  const merged = { ...current, ...partial };
  await set('autosync_config', JSON.stringify(merged));
  return merged;
}

// ---------------------------------------------------------------------------
// Bot Modes — one dial that scales sensitivity, frequency, and restraint
// together instead of tuning each setting by hand. Applied in poller.js:
// multipliers apply to the DEFAULT threshold/cooldown/cap only — a coin
// with an explicitly hand-set threshold (is_custom = true, see
// db/thresholds.js) or an explicit per-coin cooldown override is never
// scaled, since the admin already chose that exact number on purpose.
// ---------------------------------------------------------------------------
const BOT_MODES = {
  hairtrigger: {
    label: 'Hair-Trigger',
    description: 'Ultra fast \u2014 quarter of the normal threshold. Fires at the smallest move.',
    thresholdMultiplier: 0.25,
    cooldownMultiplier: 0.5,
    hourlyCapMultiplier: 2,
  },
  sharpshooter: {
    label: 'Sharp Shooter',
    description: 'Fast \u2014 half the normal threshold. Quick, but a bit more selective.',
    thresholdMultiplier: 0.5,
    cooldownMultiplier: 0.75,
    hourlyCapMultiplier: 1.5,
  },
  steadyhand: {
    label: 'Steady Hand',
    description: 'Normal \u2014 the standard threshold. Balanced default.',
    thresholdMultiplier: 1,
    cooldownMultiplier: 1,
    hourlyCapMultiplier: 1,
  },
  antispam: {
    label: 'Anti-Spam',
    description: 'Slow \u2014 double the normal threshold, plus extra spacing between posts.',
    thresholdMultiplier: 2,
    cooldownMultiplier: 2,
    hourlyCapMultiplier: 0.5,
    minGapBetweenPostsSeconds: 120, // extra restriction: applies across ALL coins, not just per-coin cooldown
  },
};
const DEFAULT_MODE = 'steadyhand';

async function getBotMode() {
  const raw = await get('bot_mode');
  return BOT_MODES[raw] ? raw : DEFAULT_MODE;
}
async function setBotMode(modeKey) {
  if (!BOT_MODES[modeKey]) throw new Error(`Unknown mode: ${modeKey}`);
  await set('bot_mode', modeKey);
  return BOT_MODES[modeKey];
}
function getModeDefinition(modeKey) {
  return BOT_MODES[modeKey] || BOT_MODES[DEFAULT_MODE];
}

// ---------------------------------------------------------------------------
// Live-editable runtime limits — things that used to only be changeable via
// an environment variable + redeploy. Each has a safe min/max so a typo
// can't silently break the bot (e.g. a 0 hourly cap or a 1-second poll
// interval); falls back to config.js's env-var value until explicitly set
// here, so nothing changes for anyone who never touches this.
// ---------------------------------------------------------------------------
const RUNTIME_LIMIT_BOUNDS = {
  pollIntervalMs: { min: 10_000, max: 300_000 },
  cooldownMinutes: { min: 1, max: 1440 },
  maxAlertsPerHour: { min: 1, max: 200 },
  defaultMuteDurationMinutes: { min: 5, max: 10080 },
  sendDelayMs: { min: 0, max: 10_000 },
  binanceFailureAlertThreshold: { min: 1, max: 50 },
  heartbeatCheckIntervalMs: { min: 60_000, max: 3_600_000 },
  heartbeatStaleMultiplier: { min: 2, max: 10 },
  memoryLimitMb: { min: 64, max: 8192 },
};

function clampToBounds(key, value) {
  const bounds = RUNTIME_LIMIT_BOUNDS[key];
  if (!bounds) return value;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

async function getRuntimeLimits() {
  const raw = await get('runtime_limits');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Reads a single limit, falling back to config.js's env-derived default
// when it hasn't been overridden here yet.
async function getRuntimeLimit(key, configFallback) {
  const overrides = await getRuntimeLimits();
  return overrides[key] !== undefined ? overrides[key] : configFallback;
}

// value is clamped to RUNTIME_LIMIT_BOUNDS before saving — the caller
// always gets back what actually got stored, so it can tell the admin the
// real applied number if their input was out of range.
async function setRuntimeLimit(key, value) {
  if (!RUNTIME_LIMIT_BOUNDS[key]) throw new Error(`Unknown runtime limit: ${key}`);
  const clamped = clampToBounds(key, value);
  const current = await getRuntimeLimits();
  current[key] = clamped;
  await set('runtime_limits', JSON.stringify(current));
  return clamped;
}

async function resetRuntimeLimit(key) {
  const current = await getRuntimeLimits();
  delete current[key];
  await set('runtime_limits', JSON.stringify(current));
}

module.exports = {
  get,
  set,
  remove,
  getAutoSyncConfig,
  setAutoSyncConfig,
  BOT_MODES,
  getBotMode,
  setBotMode,
  getModeDefinition,
  RUNTIME_LIMIT_BOUNDS,
  getRuntimeLimits,
  getRuntimeLimit,
  setRuntimeLimit,
  resetRuntimeLimit,
  isPaused,
  setPaused,
  getPausedUntil,
  setPausedUntil,
  isAnnouncementSent,
  markAnnouncementSent,
  getSecondaryChannelId,
  setSecondaryChannelId,
  getLastDigestDate,
  setLastDigestDate,
  getPinnedActions,
  setPinnedActions,
  getKillSnapshot,
  setKillSnapshot,
  clearKillSnapshot,
  getQuietHours,
  setQuietHours,
  clearQuietHours,
  getTimezone,
  setTimezone,
  getLastCapNotifiedAt,
  setLastCapNotifiedAt,
  getCompactCards,
  setCompactCards,
};
