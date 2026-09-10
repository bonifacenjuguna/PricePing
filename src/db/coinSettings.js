const { pool } = require('./postgres');
const { bySymbol } = require('../coins');

// Merges DB overrides with factory defaults from coins.js. Returns
// Map<symbol, { muted, thresholdType, thresholdValue, milestoneStep,
// milestoneDisabled, cooldownMinutes, onWatchlist, isCustom }>
async function getAllForChannel(channelId) {
  const { rows } = await pool.query('SELECT * FROM coin_settings WHERE channel_id = $1', [channelId]);
  const overrides = new Map(rows.map((r) => [r.symbol, r]));
  const map = new Map();
  for (const [symbol, coin] of bySymbol) {
    const o = overrides.get(symbol);
    map.set(symbol, {
      muted: o ? o.muted : false,
      thresholdType: o && o.threshold_value !== null ? o.threshold_type : 'pct',
      thresholdValue: o && o.threshold_value !== null ? Number(o.threshold_value) : coin.defaultThresholdPct,
      milestoneStep: o && !o.milestone_disabled && o.milestone_step !== null ? Number(o.milestone_step) : (o && o.milestone_disabled ? null : coin.milestoneStep),
      milestoneDisabled: o ? o.milestone_disabled : false,
      cooldownMinutes: o && o.cooldown_minutes !== null ? o.cooldown_minutes : null, // null = use global default
      onWatchlist: o ? o.on_watchlist : false,
      isCustom: !!o,
    });
  }
  return map;
}

async function upsert(channelId, symbol, fields) {
  const cols = [];
  const vals = [channelId, symbol];
  const setClauses = [];
  let i = 3;
  for (const [key, col] of Object.entries({
    muted: 'muted', thresholdType: 'threshold_type', thresholdValue: 'threshold_value',
    milestoneStep: 'milestone_step', milestoneDisabled: 'milestone_disabled',
    cooldownMinutes: 'cooldown_minutes', onWatchlist: 'on_watchlist',
  })) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      cols.push(col);
      vals.push(fields[key]);
      setClauses.push(`${col} = $${i}`);
      i += 1;
    }
  }
  if (!cols.length) return;
  await pool.query(
    `INSERT INTO coin_settings (channel_id, symbol, ${cols.join(', ')}, updated_at)
     VALUES ($1, $2, ${cols.map((_, idx) => `$${idx + 3}`).join(', ')}, now())
     ON CONFLICT (channel_id, symbol) DO UPDATE SET ${setClauses.join(', ')}, updated_at = now()`,
    vals
  );
}

// Bulk apply: same field set to multiple symbols in one channel — powers
// the multi-select "mute all selected", "watchlist add selected" etc flows.
async function bulkUpsert(channelId, symbols, fields) {
  for (const symbol of symbols) {
    // eslint-disable-next-line no-await-in-loop
    await upsert(channelId, symbol, fields);
  }
}

async function clearOverride(channelId, symbol) {
  await pool.query('DELETE FROM coin_settings WHERE channel_id = $1 AND symbol = $2', [channelId, symbol]);
}

module.exports = { getAllForChannel, upsert, bulkUpsert, clearOverride };
