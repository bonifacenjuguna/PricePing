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

// Standard footer for any screen: one "Back" to its logical parent, then
// Home. Used consistently so navigation depth is predictable everywhere.
function backRow(parentCallback) {
  return [{ text: '\u25C0 Back', callback_data: parentCallback }];
}
function footer(parentCallback) {
  return [backRow(parentCallback), HOME_ROW];
}

// Reusable coin-grid picker. onDataPrefix + symbol builds each button's
// callback_data, e.g. prefix "post:coin" -> "post:coin:BTC". If
// recentSymbols is non-empty, a "recently used" row is prepended above the
// full alphabetical grid so common coins aren't buried once /addcoin grows
// the list.
function coinGrid(prefix, { extraRows = [], parentCallback = 'nav:hub', recentSymbols = [] } = {}) {
  const recentRow = recentSymbols.length
    ? [recentSymbols.map((s) => ({ text: `\uD83D\uDD52 ${s}`, callback_data: `${prefix}:${s}` }))]
    : [];
  const buttons = config.coins.map((c) => ({ text: c.symbol, callback_data: `${prefix}:${c.symbol}` }));
  return [...recentRow, ...chunk(buttons, 3), ...extraRows, ...footer(parentCallback)];
}

// Reusable channel picker. "prefix" already includes everything decided so
// far, e.g. "post:send:BTC" -> "post:send:BTC:main". preferredFirst, if
// given, reorders that channel name to the front (used to surface the
// last-used test destination).
function channelPicker(prefix, channels, extraRows = [], preferredFirst = null) {
  let ordered = channels;
  if (preferredFirst) {
    const idx = ordered.findIndex((c) => c.name === preferredFirst);
    if (idx > 0) ordered = [ordered[idx], ...ordered.slice(0, idx), ...ordered.slice(idx + 1)];
  }
  const buttons = ordered.map((c) => ({
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

  let statusLine = '\uD83D\uDFE2 Running';
  if (paused && pausedUntil) {
    const remaining = new Date(pausedUntil).getTime() - Date.now();
    statusLine = `\u23F8 Paused (resumes in ${formatRemaining(remaining)})`;
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
    `Cooldown      ${config.cooldownMinutes}m per coin (default)\n` +
    `Hourly cap    ${config.maxAlertsPerHour} alerts\n` +
    heartbeatLine +
    (lastEvent
      ? `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
        `Last event: ${lastEvent.type} \u2014 ${format.timeAgo(lastEvent.created_at)}`
      : '');

  const keyboard = [
    [
      paused
        ? { text: '\u25B6 Resume', callback_data: 'action:resume' }
        : { text: '\u23F8 Pause', callback_data: 'nav:pausemenu' },
      { text: '\uD83E\uDDEA Test', callback_data: 'nav:test' },
    ],
    [
      { text: '\uD83D\uDCB0 Post', callback_data: 'nav:postmenu' },
      { text: '\uD83D\uDCC8 Chart', callback_data: 'nav:chartmenu' },
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

// ---------- Hub ----------
function hub() {
  const text =
    `PricePing \u2014 all commands\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Tap a section, or use any slash command directly \u2014 /help lists them all.`;

  const keyboard = [
    [
      { text: '\uD83D\uDCB0 Post & Chart', callback_data: 'nav:postmenu' },
      { text: '\u2699 Coin settings', callback_data: 'nav:coinsettings' },
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
      { text: '\u267B Reset', callback_data: 'nav:reset' },
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
function postMenu(recentSymbols = []) {
  const text = 'Post a price update \u2014 pick a coin:';
  return { text, keyboard: coinGrid('post:coin', { recentSymbols }) };
}

function postChannelPicker(symbol, channels) {
  const text = `Post ${symbol} to which channel?`;
  return { text, keyboard: channelPicker(`post:send:${symbol}`, channels, [backRow('nav:postmenu')]) };
}

function chartMenu(recentSymbols = []) {
  const text = 'Chart a coin \u2014 pick one:';
  return { text, keyboard: coinGrid('chart:coin', { recentSymbols }) };
}

function chartPeriodPicker(symbol) {
  const periods = ['1h', '24h', '7d', '30d'];
  const buttons = periods.map((p) => ({ text: p, callback_data: `chart:period:${symbol}:${p}` }));
  const text = `Chart period for ${symbol}?`;
  return { text, keyboard: [...chunk(buttons, 4), ...footer('nav:chartmenu')] };
}

function chartChannelPicker(symbol, period, channels) {
  const text = `Post ${symbol} (${period}) chart to which channel?\n(Or send to yourself only \u2014 "Preview".)`;
  const extra = [[{ text: '\uD83D\uDC41 Preview to me', callback_data: `chart:preview:${symbol}:${period}` }]];
  return {
    text,
    keyboard: channelPicker(`chart:send:${symbol}:${period}`, channels, [...extra, backRow(`chart:coin:${symbol}`)]),
  };
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
    `Tap a coin below for the full settings screen (threshold, milestone, cooldown, mute).`;

  const coinButtons = config.coins.map((c) => ({ text: c.symbol, callback_data: `coin:settings:${c.symbol}` }));
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
    ...footer(`coin:settings:${symbol}`),
  ];
  return { text, keyboard };
}

// ---------- Unified coin settings screen ----------
function coinSettings(symbol, { threshold, milestone, cooldownMinutes, isDefaultCooldown, mutedUntil }) {
  const tStr = threshold ? (threshold.type === 'pct' ? `${threshold.value}%` : `$${format.formatChangeUsd(threshold.value)}`) : '\u2014';
  const mStr = milestone.isDisabled ? 'off' : milestone.step ? `$${format.formatChangeUsd(milestone.step)}${milestone.isCustom ? ' (custom)' : ' (default)'}` : '\u2014';
  const cStr = `${cooldownMinutes}m${isDefaultCooldown ? ' (default)' : ' (custom)'}`;
  const muteStr = mutedUntil && new Date(mutedUntil).getTime() > Date.now() ? `muted, resumes in ${formatRemaining(new Date(mutedUntil).getTime() - Date.now())}` : 'not muted';

  const text =
    `${symbol} settings\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Threshold   ${tStr}\n` +
    `Milestone   ${mStr}\n` +
    `Cooldown    ${cStr}\n` +
    `Mute        ${muteStr}`;

  const keyboard = [
    [{ text: '\uD83C\uDFDA Threshold \u2212', callback_data: `threshold:dec:${symbol}` }, { text: '+', callback_data: `threshold:inc:${symbol}` }],
    [{ text: '\uD83C\uDFAF Milestone \u2212', callback_data: `milestone:dec:${symbol}` }, { text: '+', callback_data: `milestone:inc:${symbol}` }],
    [{ text: milestone.isDisabled ? '\uD83C\uDFAF Enable milestones' : '\uD83C\uDFAF Disable milestones', callback_data: `milestone:toggle:${symbol}` }],
    [{ text: '\u23F1 Cooldown \u2212', callback_data: `cooldown:dec:${symbol}` }, { text: '+', callback_data: `cooldown:inc:${symbol}` }],
    isDefaultCooldown ? [] : [{ text: '\u21A9 Reset cooldown to default', callback_data: `cooldown:reset:${symbol}` }],
    [{ text: '\uD83D\uDD07 Mute', callback_data: `mute:coin:${symbol}` }],
    ...footer('nav:thresholds'),
  ].filter((row) => row.length);

  return { text, keyboard };
}

// ---------- Milestones ----------
function milestoneList(milestoneMap) {
  const lines = config.coins
    .map((coin) => {
      const m = milestoneMap.get(coin.symbol);
      if (!m || m.step === null) return `${coin.symbol.padEnd(5, ' ')} off`;
      return `${coin.symbol.padEnd(5, ' ')} $${format.formatChangeUsd(m.step)}${m.isCustom ? ' (custom)' : ''}`;
    })
    .join('\n');
  const text = `Milestone steps\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\nTap a coin for full settings.`;
  const coinButtons = config.coins.map((c) => ({ text: c.symbol, callback_data: `coin:settings:${c.symbol}` }));
  return { text, keyboard: [...chunk(coinButtons, 3), HOME_ROW] };
}

// ---------- Mute ----------
function muteMenu(recentSymbols = []) {
  const text = 'Mute a coin \u2014 pick one:';
  return { text, keyboard: coinGrid('mute:coin', { recentSymbols }) };
}

function muteDurationPicker(symbol) {
  const text = `Mute ${symbol} for how long?`;
  return {
    text,
    keyboard: durationPicker(`mute:apply:${symbol}`, [
      [{ text: '\uD83D\uDD14 Unmute now', callback_data: `mute:clear:${symbol}` }],
      backRow('nav:mutemenu'),
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
    keyboard: durationPicker('pause:apply', [[{ text: '\u25B6 Resume now', callback_data: 'action:resume' }], backRow('nav:hub')]),
  };
}

// ---------- Automation ----------
function automationHub() {
  const text = 'Automation \u2014 recurring posts/charts/digests and trigger\u2192action rules.';
  const keyboard = [
    [{ text: '\uD83D\uDCC5 Schedules', callback_data: 'nav:schedules' }],
    [{ text: '\u26A1 Rules', callback_data: 'nav:rules' }],
    ...footer('nav:hub'),
  ];
  return { text, keyboard };
}

function scheduleList(schedules) {
  const lines = schedules.length
    ? schedules
        .map((s) => {
          const what = s.kind === 'chart' ? `chart ${s.symbol} (${s.period})` : s.kind === 'digest' ? 'digest' : `post ${s.symbol}`;
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
  const rowButtons = schedules.map((s) => [
    { text: `\u270F #${s.id}`, callback_data: `schedule:edit:${s.id}` },
    { text: `\u2716 #${s.id}`, callback_data: `schedule:del:${s.id}` },
  ]);
  const keyboard = [...rowButtons, [{ text: '\u2795 Add schedule', callback_data: 'schedule:add' }], ...footer('nav:automation')];
  return { text, keyboard };
}

function ruleList(rules) {
  const lines = rules.length
    ? rules
        .map((r) => {
          const trig = r.triggerSymbol ? `${r.triggerType}:${r.triggerSymbol}` : r.triggerType;
          const min = r.minMovePct !== null && r.minMovePct !== undefined ? ` (min ${r.minMovePct}%)` : '';
          return `#${r.id} on ${trig}${min} \u2192 ${r.actionType} (${r.actionParams.channel || '?'})`;
        })
        .join('\n')
    : 'No rules yet.';

  const text = `Rules\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}`;
  const rowButtons = rules.map((r) => [
    { text: `\u270F #${r.id}`, callback_data: `rule:edit:${r.id}` },
    { text: `\u2716 #${r.id}`, callback_data: `rule:del:${r.id}` },
  ]);
  const keyboard = [...rowButtons, [{ text: '\u2795 Add rule', callback_data: 'rule:add' }], ...footer('nav:automation')];
  return { text, keyboard };
}

// ---------- Channels ----------
function channelList(channels, defaultsByType) {
  const lines = channels.length
    ? channels.map((c) => `${c.isDefault ? '\u2B50' : '  '} ${c.name.padEnd(10, ' ')} ${c.chatId}`).join('\n')
    : 'No channels registered.';

  const typeLines = Object.entries(defaultsByType || {})
    .map(([type, name]) => `${type} \u2192 #${name}`)
    .join('\n');

  const text =
    `Channels\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\n\u2B50 = overall default` +
    (typeLines ? `\n\nPer-type overrides:\n${typeLines}` : '') +
    `\n\nSet a per-type default: /setdefaultchannel name threshold|milestone|manual|chart|digest`;
  const rows = channels
    .filter((c) => !c.isDefault)
    .map((c) => [
      { text: `\u2B50 Make ${c.name} default`, callback_data: `channel:setdefault:${c.name}` },
      { text: `\u2716 Remove`, callback_data: `channel:del:${c.name}` },
    ]);
  const keyboard = [...rows, [{ text: '\u2795 Add channel', callback_data: 'channel:add' }], [{ text: '\uD83D\uDCE2 Broadcast', callback_data: 'nav:broadcastmenu' }], ...footer('nav:hub')];
  return { text, keyboard };
}

function broadcastChannelPicker(channels) {
  const text = 'Broadcast a plain message to which channel?';
  return { text, keyboard: channelPicker('broadcast:pick', channels, [backRow('nav:channels')]) };
}

// ---------- Captions ----------
function captionTypes() {
  const types = ['threshold', 'milestone', 'manual', 'chart'];
  const text = 'Which caption would you like to view or edit?\n(Per-coin overrides: /setcaption type:SYMBOL <template>)';
  const buttons = types.map((t) => ({ text: t, callback_data: `caption:type:${t}` }));
  return { text, keyboard: [...chunk(buttons, 2), [{ text: '\uD83D\uDCD6 Variables', callback_data: 'nav:variables' }], ...footer('nav:hub')] };
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
    ...footer('nav:captiontypes'),
  ].filter((row) => row.length);
  return { text, keyboard };
}

function variablesHelp(docs) {
  const lines = docs.map((g) => `${g.group}:\n  ${g.vars.map((v) => `{${v}}`).join('  ')}`).join('\n\n');
  const text =
    `Available caption variables\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\n` +
    `A line containing a variable that doesn't apply (e.g. {change_pct} on a milestone alert) is dropped automatically \u2014 no need for if/else syntax.\n\n` +
    `Add your own with /setvar name value, then use {name} anywhere.`;
  return { text, keyboard: footer('nav:captiontypes') };
}

// ---------- Coin settings entry grid (from hub) ----------
function coinSettingsMenu(recentSymbols = []) {
  const text = 'Coin settings \u2014 pick a coin (threshold, milestone, cooldown, mute in one screen):';
  return { text, keyboard: coinGrid('coin:settings', { recentSymbols }) };
}

// ---------- Reset ----------
function resetMenu() {
  const text = 'Reset \u2014 pick what to reset back to defaults. Nothing happens until you confirm.';
  const options = [
    { text: 'Thresholds', code: 'thresholds' },
    { text: 'Milestones', code: 'milestones' },
    { text: 'Cooldowns', code: 'cooldowns' },
    { text: 'Captions', code: 'captions' },
    { text: 'Variables', code: 'vars' },
    { text: 'Channels', code: 'channels' },
    { text: 'Automation', code: 'automation' },
  ];
  const buttons = options.map((o) => ({ text: o.text, callback_data: `reset:confirm:${o.code}` }));
  return {
    text,
    keyboard: [...chunk(buttons, 2), [{ text: '\u26A0 Reset EVERYTHING', callback_data: 'reset:confirm:everything' }], ...footer('nav:hub')],
  };
}

function resetConfirm(type) {
  const labels = {
    thresholds: 'every threshold back to its factory default',
    milestones: 'every milestone step back to its factory default',
    cooldowns: 'every per-coin cooldown override (back to the global default)',
    captions: 'every custom caption template (including per-coin overrides)',
    vars: 'every custom {variable}',
    channels: 'every channel except "main" (which becomes default again)',
    automation: 'every schedule and every rule',
    everything: 'ALL of the above, in one shot',
  };
  const text = `\u26A0\uFE0F This will reset ${labels[type] || type}. This can't be undone. Confirm?`;
  const keyboard = [
    [
      { text: '\u2705 Yes, reset', callback_data: `reset:execute:${type}` },
      { text: '\u274C Cancel', callback_data: 'nav:reset' },
    ],
    HOME_ROW,
  ];
  return { text, keyboard };
}

// ---------- Add-coin confirm ----------
function addCoinConfirm({ symbol, name, pair, color }) {
  const text = `Add this coin?\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nSymbol  ${symbol}\nName    ${name}\nPair    ${pair}\nColor   ${color}`;
  const keyboard = [
    [
      { text: '\u2705 Confirm', callback_data: 'addcoin:confirm' },
      { text: '\u274C Cancel', callback_data: 'addcoin:cancel' },
    ],
    HOME_ROW,
  ];
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
    `Use /history SYMBOL [channel] for a per-coin breakdown.`;

  const keyboard = [HOME_ROW];
  return { text, keyboard };
}

// ---------- Settings ----------
function settings() {
  const text =
    `Settings\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Poll interval     ${config.pollIntervalMs / 1000}s\n` +
    `Cooldown default  ${config.cooldownMinutes}m per coin\n` +
    `Hourly send cap   ${config.maxAlertsPerHour}\n` +
    `Memory limit      ${config.memoryLimitMb}MB\n\n` +
    `These are environment variables and take effect on next restart. ` +
    `Channels, captions, thresholds, milestones, cooldowns, schedules (including digests), and rules are all live \u2014 see /commands.`;
  const keyboard = [HUB_ROW, HOME_ROW];
  return { text, keyboard };
}

// ---------- Test picker (advanced) ----------
function testPicker(recentSymbols = []) {
  const text = 'Test alert \u2014 pick a coin:';
  return { text, keyboard: coinGrid('test:coin', { extraRows: [[{ text: '\u26A1 Run full pipeline check', callback_data: 'test:full' }]], recentSymbols }) };
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
  return { text, keyboard: [...chunk(buttons, 2), ...footer('nav:test')] };
}

function testValuePicker(symbol, type) {
  const text = `${symbol} ${type} \u2014 pick a move to simulate:`;
  const presets = [
    { text: '+2%', code: 'plus2' },
    { text: '-5%', code: 'minus5' },
    { text: '+10%', code: 'plus10' },
  ];
  const buttons = presets.map((p) => ({ text: p.text, callback_data: `test:value:${symbol}:${type}:${p.code}` }));
  return { text, keyboard: [...chunk(buttons, 3), backRow(`test:coin:${symbol}`), HOME_ROW] };
}

function testDestinationPicker(symbol, type, valueCode, channels, lastDestination) {
  const text = `Send test ${type} for ${symbol} where?`;
  const extra = [[{ text: '\uD83D\uDC41 Preview to me only', callback_data: `test:send:${symbol}:${type}:${valueCode}:preview` }]];
  return { text, keyboard: channelPicker(`test:send:${symbol}:${type}:${valueCode}`, channels, extra, lastDestination) };
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
  coinSettings,
  coinSettingsMenu,
  milestoneList,
  muteMenu,
  muteDurationPicker,
  pauseMenu,
  automationHub,
  scheduleList,
  ruleList,
  channelList,
  broadcastChannelPicker,
  captionTypes,
  captionDetail,
  variablesHelp,
  resetMenu,
  resetConfirm,
  addCoinConfirm,
  stats,
  settings,
  testPicker,
  testTypePicker,
  testValuePicker,
  testDestinationPicker,
  HOME_ROW,
  HUB_ROW,
};
