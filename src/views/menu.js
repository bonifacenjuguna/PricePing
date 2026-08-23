const config = require('../config');
const format = require('../utils/format');
const { formatRemaining } = require('../utils/duration');

const HOME_ROW = [{ text: '\uD83C\uDFE0 Home', callback_data: 'nav:home' }]; // 🏠

// ---------- Home ----------
function home({ paused, pausedUntil, uptimeSeconds, alertsToday, lastEvent, heartbeat }) {
  const uptimeStr = formatUptime(uptimeSeconds);

  let statusLine = '\uD83D\uDFE2 Running'; // 🟢
  if (paused && pausedUntil) {
    const remaining = new Date(pausedUntil).getTime() - Date.now();
    statusLine = `\u23F8 Paused (resumes in ${formatRemaining(remaining)})`; // ⏸
  } else if (paused) {
    statusLine = '\u23F8 Paused (indefinitely)';
  }

  let heartbeatLine = '';
  if (heartbeat && heartbeat.lastTickAt) {
    heartbeatLine = `Last tick    ${format.timeAgo(heartbeat.lastTickAt)} (${heartbeat.lastTickMs}ms)\n`;
  }

  const text =
    `PricePing \u2014 status\n` +
    `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `${statusLine}\n` +
    `Uptime        ${uptimeStr}\n` +
    `Alerts today  ${alertsToday}\n` +
    `Poll interval ${config.pollIntervalMs / 1000}s\n` +
    `Cooldown      ${config.cooldownMinutes}m per coin\n` +
    `Hourly cap    ${config.maxAlertsPerHour} alerts\n` +
    heartbeatLine +
    (lastEvent
      ? `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
        `Last event: ${lastEvent.type} \u2014 ${format.timeAgo(lastEvent.created_at)}`
      : '');

  const keyboard = [
    [
      paused
        ? { text: '\u25B6 Resume', callback_data: 'action:resume' } // ▶
        : { text: '\u23F8 Pause', callback_data: 'action:pause' }, // ⏸
      { text: '\uD83E\uDDEA Test alert', callback_data: 'nav:test' }, // 🧪
    ],
    [
      { text: '\uD83D\uDCCA Stats', callback_data: 'nav:stats' }, // 📊
      { text: '\u2699 Settings', callback_data: 'nav:settings' }, // ⚙
    ],
  ];

  return { text, keyboard };
}

function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------- Prices ----------
function prices(priceMap) {
  const lines = config.coins
    .map((coin) => {
      const price = priceMap[coin.symbol];
      const priceStr = price === undefined ? '\u2014' : `$${format.formatPrice(price)}`;
      return `${coin.symbol.padEnd(5, ' ')} ${priceStr}`;
    })
    .join('\n');

  const text = `Current prices\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}`;
  const keyboard = [
    [{ text: '\uD83D\uDD04 Refresh', callback_data: 'nav:prices' }], // 🔄
    HOME_ROW,
  ];
  return { text, keyboard };
}

// ---------- Thresholds ----------
function thresholds(thresholdMap) {
  const lines = config.coins
    .map((coin) => {
      const t = thresholdMap[coin.symbol];
      if (!t) return `${coin.symbol.padEnd(5, ' ')} \u2014`;
      const tStr = t.type === 'pct' ? `${t.value}%` : `$${format.formatChangeUsd(t.value)}`;
      return `${coin.symbol.padEnd(5, ' ')} ${tStr}`;
    })
    .join('\n');

  const text =
    `Alert thresholds\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\n` +
    `To change one: /setthreshold SYMBOL AMOUNT [pct]\n` +
    `Example: /setthreshold BTC 400\n` +
    `Or: /setthreshold BTC 2 pct  (2% move)`;

  const keyboard = [HOME_ROW];
  return { text, keyboard };
}

// ---------- Stats ----------
function stats({ today, allTime, perCoin }) {
  const perCoinLines = perCoin.length
    ? perCoin
        .map((row) => `${row.symbol.padEnd(5, ' ')} ${row.count}  (last ${format.timeAgo(row.last_alert_at)})`)
        .join('\n')
    : 'No alerts sent yet.';

  const text =
    `Alert stats\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Today      ${today}\n` +
    `All-time   ${allTime}\n` +
    `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Per coin (all-time):\n${perCoinLines}\n\n` +
    `Use /history SYMBOL for a per-coin breakdown.`;

  const keyboard = [HOME_ROW];
  return { text, keyboard };
}

// ---------- Settings ----------
function settings({ secondaryChannelId }) {
  const text =
    `Settings\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Poll interval     ${config.pollIntervalMs / 1000}s\n` +
    `Cooldown          ${config.cooldownMinutes}m per coin\n` +
    `Hourly send cap   ${config.maxAlertsPerHour}\n` +
    `Memory limit      ${config.memoryLimitMb}MB\n` +
    `Daily digest      ${config.digestEnabled ? `${config.digestHourUtc}:00 UTC` : 'disabled'}\n` +
    `Secondary channel ${secondaryChannelId || 'not set'}\n\n` +
    `Poll/cooldown/cap/memory/digest are environment variables (take effect on next restart). ` +
    `Secondary channel is live \u2014 set with /setsecondary CHANNEL_ID, clear with /clearsecondary.`;
  const keyboard = [HOME_ROW];
  return { text, keyboard };
}

// ---------- Test alert picker ----------
function testPicker() {
  const rows = [];
  for (let i = 0; i < config.coins.length; i += 3) {
    rows.push(
      config.coins.slice(i, i + 3).map((coin) => ({
        text: coin.symbol,
        callback_data: `action:test:${coin.symbol}`,
      }))
    );
  }
  const text = 'Pick a coin to send a sample alert card for:';
  return { text, keyboard: [...rows, HOME_ROW] };
}

module.exports = { home, prices, thresholds, stats, settings, testPicker, HOME_ROW };
