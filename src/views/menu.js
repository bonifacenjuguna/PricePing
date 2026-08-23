const config = require('../config');
const format = require('../utils/format');
const { formatRemaining } = require('../utils/duration');

const HOME_ROW = [{ text: '\uD83C\uDFE0 Home', callback_data: 'nav:home' }]; // 🏠
const HUB_ROW = [{ text: '\u2630 All commands', callback_data: 'nav:hub' }]; // ☰

function chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

// Reusable coin-grid picker. onDataPrefix + symbol builds each button's
// callback_data, e.g. prefix "post:coin" -> "post:coin:BTC".
function coinGrid(prefix, extraRows = []) {
  const buttons = config.coins.map((c) => ({ text: c.symbol, callback_data: `${prefix}:${c.symbol}` }));
  return [...chunk(buttons, 3), ...extraRows, HOME_ROW];
}

// Reusable channel picker, shown after a coin/action is chosen. Marks the
// default channel. "prefix" already includes everything decided so far,
// e.g. "post:send:BTC" -> "post:send:BTC:main".
function channelPicker(prefix, channels, extraRows = []) {
  const buttons = channels.map((c) => ({
    text: c.isDefault ? `\u2B50 ${c.name}` : c.name,
    callback_data: `${prefix}:${c.name}`,
  }));
  return [...chunk(buttons, 2), ...extraRows, HOME_ROW];
}

function durationPicker(prefix, extraRows = []) {
  const options = [
    { text: '30m', code: '30m' },
    { text: '1h', code: '1h' },
    { text: '4h', code: '4h' },
    { text: '1d', code: '1d' },
    { text: 'Indefinite', code: 'indef' },
  ];
  const buttons = options.map((o) => ({ text: o.text, callback_data: `${prefix}:${o.code}` }));
  return [...chunk(buttons, 3), ...extraRows, HOME_ROW];
}

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
        : { text: '\u23F8 Pause', callback_data: 'nav:pausemenu' }, // ⏸
      { text: '\uD83E\uDDEA Test', callback_data: 'nav:test' }, // 🧪
    ],
    [
      { text: '\uD83D\uDCB0 Post', callback_data: 'nav:postmenu' }, // 💰
      { text: '\uD83D\uDCC8 Chart', callback_data: 'nav:chartmenu' }, // 📈
    ],
    [
      { text: '\uD83D\uDCCA Stats', callback_data: 'nav:stats' },
      { text: '\u2699 Settings', callback_data: 'nav:settings' },
    ],
    HUB_ROW,
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

// ---------- Hub (the "/commands" shortcut screen) ----------
function hub() {
  const text =
    `PricePing \u2014 all commands\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Tap a section, or use any slash command directly \u2014 /help lists them all.`;

  const keyboard = [
    [
      { text: '\uD83D\uDCB0 Post & Chart', callback_data: 'nav:postmenu' },
      { text: '\uD83C\uDFDA Thresholds', callback_data: 'nav:thresholds' },
    ],
    [
      { text: '\uD83D\uDD07 Mute', callback_data: 'nav:mutemenu' },
      { text: '\u23F8 Pause/Resume', callback_data: 'nav:pausemenu' },
    ],
    [
      { text: '\uD83D\uDCC5 Automation', callback_data: 'nav:automation' },
      { text: '\uD83D\uDCE1 Channels', callback_data: 'nav:channels' },
    ],
    [
      { text: '\u270F Captions', callback_data: 'nav:captiontypes' },
      { text: '\uD83E\uDDEA Test', callback_data: 'nav:test' },
    ],
    [
      { text: '\uD83D\uDCCA Stats', callback_data: 'nav:stats' },
      { text: '\u2699 Settings', callback_data: 'nav:settings' },
    ],
    HOME_ROW,
  ];
  return { text, keyboard };
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
    [{ text: '\uD83D\uDD04 Refresh', callback_data: 'nav:prices' }],
    [{ text: '\uD83D\uDCB0 Post one', callback_data: 'nav:postmenu' }],
    HOME_ROW,
  ];
  return { text, keyboard };
}

// ---------- Post / Chart menus ----------
function postMenu() {
  const text = 'Post a price update \u2014 pick a coin:';
  return { text, keyboard: coinGrid('post:coin') };
}

function postChannelPicker(symbol, channels) {
  const text = `Post ${symbol} to which channel?`;
  return { text, keyboard: channelPicker(`post:send:${symbol}`, channels, [[{ text: '\u25C0 Back', callback_data: 'nav:postmenu' }]]) };
}

function chartMenu() {
  const text = 'Chart a coin \u2014 pick one:';
  return { text, keyboard: coinGrid('chart:coin') };
}

function chartPeriodPicker(symbol) {
  const periods = ['1h', '24h', '7d', '30d'];
  const buttons = periods.map((p) => ({ text: p, callback_data: `chart:period:${symbol}:${p}` }));
  const text = `Chart period for ${symbol}?`;
  return { text, keyboard: [...chunk(buttons, 4), [{ text: '\u25C0 Back', callback_data: 'nav:chartmenu' }], HOME_ROW] };
}

function chartChannelPicker(symbol, period, channels) {
  const text = `Post ${symbol} (${period}) chart to which channel?\n(Or send to yourself only \u2014 "Preview".)`;
  const extra = [[{ text: '\uD83D\uDC41 Preview to me', callback_data: `chart:preview:${symbol}:${period}` }]];
  return {
    text,
    keyboard: channelPicker(`chart:send:${symbol}:${period}`, channels, [
      ...extra,
      [{ text: '\u25C0 Back', callback_data: `chart:coin:${symbol}` }],
    ]),
  };
}

// ---------- Thresholds (with +/- buttons) ----------
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
    `Tap a coin to adjust with +/\u2212, or use /setthreshold SYMBOL AMOUNT [pct] for an exact value.`;

  const coinButtons = config.coins.map((c) => ({ text: c.symbol, callback_data: `threshold:edit:${c.symbol}` }));
  const keyboard = [...chunk(coinButtons, 3), HOME_ROW];
  return { text, keyboard };
}

function thresholdEdit(symbol, threshold) {
  const tStr = threshold ? (threshold.type === 'pct' ? `${threshold.value}%` : `$${format.formatChangeUsd(threshold.value)}`) : '\u2014';
  const text = `${symbol} threshold: ${tStr}`;
  const keyboard = [
    [
      { text: '\u2212', callback_data: `threshold:dec:${symbol}` },
      { text: '+', callback_data: `threshold:inc:${symbol}` },
    ],
    [{ text: '\u25C0 Back', callback_data: 'nav:thresholds' }],
    HOME_ROW,
  ];
  return { text, keyboard };
}

// ---------- Mute ----------
function muteMenu() {
  const text = 'Mute a coin \u2014 pick one:';
  return { text, keyboard: coinGrid('mute:coin') };
}

function muteDurationPicker(symbol) {
  const text = `Mute ${symbol} for how long?`;
  return {
    text,
    keyboard: durationPicker(`mute:apply:${symbol}`, [
      [{ text: '\uD83D\uDD14 Unmute now', callback_data: `mute:clear:${symbol}` }],
      [{ text: '\u25C0 Back', callback_data: 'nav:mutemenu' }],
    ]),
  };
}

// ---------- Pause ----------
function pauseMenu({ paused, pausedUntil }) {
  const status = paused
    ? pausedUntil
      ? `Currently paused (resumes in ${formatRemaining(new Date(pausedUntil).getTime() - Date.now())})`
      : 'Currently paused (indefinitely)'
    : 'Currently running';
  const text = `${status}\n\nPause for how long?`;
  return {
    text,
    keyboard: durationPicker('pause:apply', [[{ text: '\u25B6 Resume now', callback_data: 'action:resume' }]]),
  };
}

// ---------- Automation ----------
function automationHub() {
  const text = 'Automation \u2014 recurring posts/charts and trigger\u2192action rules.';
  const keyboard = [
    [{ text: '\uD83D\uDCC5 Schedules', callback_data: 'nav:schedules' }],
    [{ text: '\u26A1 Rules', callback_data: 'nav:rules' }],
    HOME_ROW,
  ];
  return { text, keyboard };
}

function scheduleList(schedules) {
  const lines = schedules.length
    ? schedules
        .map((s) => {
          const what = s.kind === 'chart' ? `chart ${s.symbol} (${s.period})` : `post ${s.symbol}`;
          const when =
            s.cadence === 'hourly'
              ? `hourly :${String(s.atMinuteUtc).padStart(2, '0')}`
              : s.cadence === 'daily'
              ? `daily ${String(s.atHourUtc).padStart(2, '0')}:${String(s.atMinuteUtc).padStart(2, '0')} UTC`
              : `weekly (day ${s.dayOfWeek}) ${String(s.atHourUtc).padStart(2, '0')}:${String(s.atMinuteUtc).padStart(2, '0')} UTC`;
          return `#${s.id} ${what} \u2192 #${s.channelName}, ${when}`;
        })
        .join('\n')
    : 'No schedules yet.';

  const text = `Schedules\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}`;
  const delButtons = schedules.map((s) => ({ text: `\u2716 #${s.id}`, callback_data: `schedule:del:${s.id}` }));
  const keyboard = [...chunk(delButtons, 3), [{ text: '\u2795 Add schedule', callback_data: 'schedule:add' }], [{ text: '\u25C0 Back', callback_data: 'nav:automation' }], HOME_ROW];
  return { text, keyboard };
}

function ruleList(rules) {
  const lines = rules.length
    ? rules
        .map((r) => {
          const trig = r.triggerSymbol ? `${r.triggerType}:${r.triggerSymbol}` : r.triggerType;
          return `#${r.id} on ${trig} \u2192 ${r.actionType} (${r.actionParams.channel || '?'})`;
        })
        .join('\n')
    : 'No rules yet.';

  const text = `Rules\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}`;
  const delButtons = rules.map((r) => ({ text: `\u2716 #${r.id}`, callback_data: `rule:del:${r.id}` }));
  const keyboard = [...chunk(delButtons, 3), [{ text: '\u2795 Add rule', callback_data: 'rule:add' }], [{ text: '\u25C0 Back', callback_data: 'nav:automation' }], HOME_ROW];
  return { text, keyboard };
}

// ---------- Channels ----------
function channelList(channels) {
  const lines = channels.length
    ? channels.map((c) => `${c.isDefault ? '\u2B50' : '  '} ${c.name.padEnd(10, ' ')} ${c.chatId}`).join('\n')
    : 'No channels registered.';

  const text = `Channels\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\n\u2B50 = default target for automatic alerts`;
  const rows = channels
    .filter((c) => !c.isDefault)
    .map((c) => [
      { text: `\u2B50 Make ${c.name} default`, callback_data: `channel:setdefault:${c.name}` },
      { text: `\u2716 Remove`, callback_data: `channel:del:${c.name}` },
    ]);
  const keyboard = [...rows, [{ text: '\u2795 Add channel', callback_data: 'channel:add' }], HOME_ROW];
  return { text, keyboard };
}

// ---------- Captions ----------
function captionTypes() {
  const types = ['threshold', 'milestone', 'manual', 'chart'];
  const text = 'Which caption would you like to view or edit?';
  const buttons = types.map((t) => ({ text: t, callback_data: `caption:type:${t}` }));
  return { text, keyboard: [...chunk(buttons, 2), [{ text: '\uD83D\uDCD6 Variables', callback_data: 'nav:variables' }], HOME_ROW] };
}

function captionDetail(alertType, currentTemplate, isCustom) {
  const text =
    `Caption \u2014 ${alertType}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `${isCustom ? '(custom)' : '(default)'}\n\n${currentTemplate}`;
  const keyboard = [
    [{ text: '\u270F Edit', callback_data: `caption:edit:${alertType}` }],
    [{ text: '\uD83D\uDC41 Preview', callback_data: `caption:preview:${alertType}` }],
    isCustom ? [{ text: '\u21A9 Reset to default', callback_data: `caption:reset:${alertType}` }] : [],
    [{ text: '\uD83D\uDCD6 Variables', callback_data: 'nav:variables' }],
    [{ text: '\u25C0 Back', callback_data: 'nav:captiontypes' }],
    HOME_ROW,
  ].filter((row) => row.length);
  return { text, keyboard };
}

function variablesHelp(docs) {
  const lines = docs.map((g) => `${g.group}:\n  ${g.vars.map((v) => `{${v}}`).join('  ')}`).join('\n\n');
  const text =
    `Available caption variables\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\n` +
    `A line containing a variable that doesn't apply (e.g. {change_pct} on a milestone alert) is dropped automatically \u2014 no need for if/else syntax.\n\n` +
    `Add your own with /setvar name value, then use {name} anywhere.`;
  return { text, keyboard: [HOME_ROW] };
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
function settings() {
  const text =
    `Settings\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Poll interval     ${config.pollIntervalMs / 1000}s\n` +
    `Cooldown          ${config.cooldownMinutes}m per coin\n` +
    `Hourly send cap   ${config.maxAlertsPerHour}\n` +
    `Memory limit      ${config.memoryLimitMb}MB\n` +
    `Daily digest      ${config.digestEnabled ? `${config.digestHourUtc}:00 UTC` : 'disabled'}\n\n` +
    `These are environment variables and take effect on next restart. ` +
    `Channels, captions, thresholds, schedules, and rules are all live \u2014 see /commands.`;
  const keyboard = [HUB_ROW, HOME_ROW];
  return { text, keyboard };
}

// ---------- Test picker (advanced) ----------
function testPicker() {
  const text = 'Test alert \u2014 pick a coin:';
  return { text, keyboard: coinGrid('test:coin', [[{ text: '\u26A1 Run full pipeline check', callback_data: 'test:full' }]]) };
}

function testTypePicker(symbol) {
  const text = `Test type for ${symbol}?`;
  const types = [
    { text: 'Threshold', code: 'threshold' },
    { text: 'Milestone', code: 'milestone' },
    { text: 'Manual post', code: 'manual' },
    { text: 'Chart', code: 'chart' },
  ];
  const buttons = types.map((t) => ({ text: t.text, callback_data: `test:type:${symbol}:${t.code}` }));
  return { text, keyboard: [...chunk(buttons, 2), [{ text: '\u25C0 Back', callback_data: 'nav:test' }], HOME_ROW] };
}

function testValuePicker(symbol, type) {
  const text = `${symbol} ${type} \u2014 pick a move to simulate:`;
  const presets = [
    { text: '+2%', code: 'plus2' },
    { text: '-5%', code: 'minus5' },
    { text: '+10%', code: 'plus10' },
  ];
  const buttons = presets.map((p) => ({ text: p.text, callback_data: `test:value:${symbol}:${type}:${p.code}` }));
  return { text, keyboard: [...chunk(buttons, 3), [{ text: '\u25C0 Back', callback_data: `test:coin:${symbol}` }], HOME_ROW] };
}

function testDestinationPicker(symbol, type, valueCode, channels) {
  const text = `Send test ${type} for ${symbol} where?`;
  const extra = [[{ text: '\uD83D\uDC41 Preview to me only', callback_data: `test:send:${symbol}:${type}:${valueCode}:preview` }]];
  return { text, keyboard: channelPicker(`test:send:${symbol}:${type}:${valueCode}`, channels, extra) };
}

module.exports = {
  home,
  hub,
  prices,
  postMenu,
  postChannelPicker,
  chartMenu,
  chartPeriodPicker,
  chartChannelPicker,
  thresholds,
  thresholdEdit,
  muteMenu,
  muteDurationPicker,
  pauseMenu,
  automationHub,
  scheduleList,
  ruleList,
  channelList,
  captionTypes,
  captionDetail,
  variablesHelp,
  stats,
  settings,
  testPicker,
  testTypePicker,
  testValuePicker,
  testDestinationPicker,
  HOME_ROW,
  HUB_ROW,
};
