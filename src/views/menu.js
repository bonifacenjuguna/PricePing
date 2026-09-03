const config = require('../config');
const format = require('../utils/format');
const { formatRemaining } = require('../utils/duration');

const HOME_ROW = [{ text: '\uD83C\uDFE0 Home', callback_data: 'nav:home' }]; // 🏠
const HUB_ROW = [{ text: '\u2630 All commands', callback_data: 'nav:hub' }]; // ☰

// Fixed catalog for the pinnable "⭐ Quick actions" row on Home — kept to a
// short, safe set of navigation-only shortcuts (no destructive actions)
// so pinning is low-risk regardless of what's picked.
const PINNABLE_ACTIONS = [
  { key: 'prices', label: '\uD83D\uDCB0 Prices', cb: 'nav:prices' },
  { key: 'postmenu', label: '\uD83D\uDCB8 Post', cb: 'nav:postmenu' },
  { key: 'chartmenu', label: '\uD83D\uDCC8 Chart', cb: 'nav:chartmenu' },
  { key: 'test', label: '\uD83E\uDDEA Test', cb: 'nav:test' },
  { key: 'pausemenu', label: '\u23F8 Pause/Resume', cb: 'nav:pausemenu' },
  { key: 'stats', label: '\uD83D\uDCCA Stats', cb: 'nav:stats' },
  { key: 'history', label: '\uD83D\uDCDC History', cb: 'nav:history' },
  { key: 'channels', label: '\uD83D\uDCE1 Channels', cb: 'nav:channels' },
];

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
function home({ paused, pausedUntil, uptimeSeconds, alertsToday, lastEvent, heartbeat, pinnedKeys = [], killSwitchActive = false }) {
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

  const pinnedRow = pinnedKeys.length
    ? [PINNABLE_ACTIONS.filter((a) => pinnedKeys.includes(a.key)).map((a) => ({ text: a.label, callback_data: a.cb }))]
    : [];

  const keyboard = [
    ...pinnedRow,
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
    [{ text: killSwitchActive ? '\u267B Restore (kill switch active)' : '\uD83D\uDED1 Kill switch', callback_data: 'action:killswitch' }],
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
      { text: '\uD83D\uDCDC History', callback_data: 'nav:history' },
    ],
    [
      { text: '\uD83D\uDC8E Markets', callback_data: 'nav:markets' },
      { text: '\uD83D\uDCC8 Movers', callback_data: 'nav:movers' },
    ],
    [
      { text: '\uD83D\uDE28 Fear & Greed', callback_data: 'nav:feargreed' },
    ],
    [
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

// Asked right after picking a coin, before the period — lets the user
// choose a clean line chart or a full candlestick chart for this render.
function chartStylePicker(symbol) {
  const buttons = [
    { text: '\uD83D\uDCC8 Line', callback_data: `chart:style:${symbol}:line` },
    { text: '\uD83D\uDD6F\uFE0F Candles', callback_data: `chart:style:${symbol}:candle` },
  ];
  const text = `${symbol} chart \u2014 line or candlesticks?`;
  return { text, keyboard: [buttons, ...footer('nav:chartmenu')] };
}

function chartPeriodPicker(symbol, style = 'line') {
  const periods = ['1h', '24h', '7d', '30d'];
  const buttons = periods.map((p) => ({ text: p, callback_data: `chart:period:${symbol}:${p}:${style}` }));
  const styleLabel = style === 'candle' ? 'Candlestick' : 'Line';
  const text = `${styleLabel} chart period for ${symbol}?`;
  return { text, keyboard: [...chunk(buttons, 4), ...footer(`chart:coin:${symbol}`)] };
}

function chartChannelPicker(symbol, period, style, channels) {
  const styleLabel = style === 'candle' ? 'candlestick' : 'line';
  const text = `Post ${symbol} (${period}, ${styleLabel}) chart to which channel?\n(Or send to yourself only \u2014 "Preview".)`;
  const extra = [[{ text: '\uD83D\uDC41 Preview to me', callback_data: `chart:preview:${symbol}:${period}:${style}` }]];
  return {
    text,
    keyboard: channelPicker(`chart:send:${symbol}:${period}:${style}`, channels, [
      ...extra,
      backRow(`chart:style:${symbol}:${style}`),
    ]),
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
function coinSettings(symbol, { threshold, milestone, cooldownMinutes, isDefaultCooldown, mutedUntil, globallyPaused, lastAlertText, hasCoinPostButton = true, isCustom = false, inWatchlist = false }) {
  const tStr = threshold ? (threshold.type === 'pct' ? `${threshold.value}%` : `$${format.formatChangeUsd(threshold.value)}`) : '\u2014';
  const mStr = milestone.isDisabled ? 'off' : milestone.step ? `$${format.formatChangeUsd(milestone.step)}${milestone.isCustom ? ' (custom)' : ' (default)'}` : '\u2014';
  const cStr = `${cooldownMinutes}m${isDefaultCooldown ? ' (default)' : ' (custom)'}`;
  const isMuted = mutedUntil && new Date(mutedUntil).getTime() > Date.now();
  const muteStr = isMuted ? `muted, resumes in ${formatRemaining(new Date(mutedUntil).getTime() - Date.now())}` : 'not muted';

  // "Why is this coin quiet?" — mute, global pause, and a missing/disabled
  // threshold or milestone all silence a coin identically from the
  // outside, so spell out which one(s) actually apply right now.
  const reasons = [];
  if (globallyPaused) reasons.push('the bot is globally paused');
  if (isMuted) reasons.push(`${symbol} is muted`);
  if (!threshold) reasons.push('no threshold is set (no threshold alerts will fire)');
  if (milestone.isDisabled) reasons.push('milestones are off for this coin');
  const statusLine = reasons.length ? `\n\u26A0\uFE0F Currently quiet because: ${reasons.join('; ')}.` : '';

  const text =
    `${symbol} settings\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Threshold   ${tStr}\n` +
    `Milestone   ${mStr}\n` +
    `Cooldown    ${cStr}\n` +
    `Mute        ${muteStr}\n` +
    `Last alert  ${lastAlertText || 'never'}` +
    statusLine +
    `\n\nThreshold and milestone alerts are independent \u2014 a coin can fire both for the same move (one because it moved $X, the other because it crossed a round number).`;

  const keyboard = [
    [{ text: '\uD83D\uDCB0 Post now', callback_data: `post:coin:${symbol}` }],
    [{ text: '\uD83C\uDFDA Threshold \u2212', callback_data: `threshold:dec:${symbol}` }, { text: '+', callback_data: `threshold:inc:${symbol}` }, { text: '\u270F Exact', callback_data: `threshold:setexact:${symbol}` }],
    [{ text: '\uD83C\uDFAF Milestone \u2212', callback_data: `milestone:dec:${symbol}` }, { text: '+', callback_data: `milestone:inc:${symbol}` }, { text: '\u270F Exact', callback_data: `milestone:setexact:${symbol}` }],
    [{ text: milestone.isDisabled ? '\uD83C\uDFAF Enable milestones' : '\uD83C\uDFAF Disable milestones', callback_data: `milestone:toggle:${symbol}` }],
    [{ text: '\u23F1 Cooldown \u2212', callback_data: `cooldown:dec:${symbol}` }, { text: '+', callback_data: `cooldown:inc:${symbol}` }],
    isDefaultCooldown ? [] : [{ text: '\u21A9 Reset cooldown to default', callback_data: `cooldown:reset:${symbol}` }],
    [{ text: '\uD83D\uDD07 Mute', callback_data: `mute:coin:${symbol}` }],
    [{ text: '\uD83D\uDCDC History', callback_data: `history:coin:${symbol}` }],
    [{ text: inWatchlist ? '\u2B50 Remove from watchlist' : '\u2606 Add to watchlist', callback_data: `markets:watch:${symbol}` }],
    isCustom ? [{ text: '\uD83D\uDDD1 Remove coin', callback_data: `removecoin:pick:${symbol}` }] : [],
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
  return { text, keyboard: [...chunk(coinButtons, 3), ...footer('nav:coinsettings')] };
}

// ---------- Mute ----------
function muteMenu(recentSymbols = [], mutedMap = {}) {
  const mutedEntries = Object.entries(mutedMap).filter(([, until]) => until && new Date(until).getTime() > Date.now());
  const summary = mutedEntries.length
    ? `Currently muted: ${mutedEntries.map(([s, u]) => `${s} (${formatRemaining(new Date(u).getTime() - Date.now())})`).join(', ')}\n\n`
    : '';
  const text = `${summary}Mute a coin \u2014 pick one:`;

  const recentRow = recentSymbols.length
    ? [recentSymbols.map((s) => ({ text: `\uD83D\uDD52 ${s}`, callback_data: `mute:coin:${s}` }))]
    : [];
  const buttons = config.coins.map((c) => ({
    text: mutedMap[c.symbol] && new Date(mutedMap[c.symbol]).getTime() > Date.now() ? `\uD83D\uDD07 ${c.symbol}` : c.symbol,
    callback_data: `mute:coin:${c.symbol}`,
  }));
  return { text, keyboard: [...recentRow, ...chunk(buttons, 3), ...footer('nav:hub')] };
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
  const text = 'Automation \u2014 recurring posts/charts/digests, trigger\u2192action rules, and bulk/group tools.';
  const keyboard = [
    [{ text: '\uD83D\uDCC5 Schedules', callback_data: 'nav:schedules' }],
    [{ text: '\u26A1 Rules', callback_data: 'nav:rules' }],
    [{ text: '\uD83D\uDCCA Send digest now', callback_data: 'digest:now' }],
    [
      { text: '\uD83E\uDDF0 Bulk actions', callback_data: 'bulk:start' },
      { text: '\uD83C\uDFF7 Tags', callback_data: 'nav:tags' },
    ],
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

// ---------- Rule wizard (button-driven /addrule) ----------
// Every screen below shows a running summary of what's been picked so far,
// so the flow reads as "building up a sentence" rather than a blind
// sequence of taps. `s` is the accumulated wizardState.data for this flow.
function describeRuleSoFar(s) {
  const bits = [];
  if (s.triggerType) {
    const trig = s.triggerSymbol ? `${s.triggerType}:${s.triggerSymbol}` : s.triggerType === 'any_alert' ? 'any alert' : s.triggerType;
    bits.push(`When: ${trig}`);
  }
  if (s.triggerDirection) bits.push(`Direction: ${s.triggerDirection} only`);
  if (s.minMovePct !== undefined && s.minMovePct !== null) bits.push(`Min move: ${s.minMovePct}%`);
  if (s.actionType) {
    const actLabel = { mirror: 'Mirror to', post_chart: 'Post chart to', broadcast: 'Broadcast to', mute_coin: 'Mute' }[s.actionType];
    bits.push(`Then: ${actLabel || s.actionType}`);
  }
  if (s.actionParams && s.actionParams.channel) bits.push(`Channel: #${s.actionParams.channel}`);
  if (s.actionParams && s.actionParams.period) bits.push(`Period: ${s.actionParams.period}`);
  if (s.actionParams && s.actionType === 'mute_coin' && s.actionParams.symbol) bits.push(`Coin: ${s.actionParams.symbol}`);
  return bits.length ? `${bits.join(' \u00B7 ')}\n\n` : '';
}

function ruleWizardTrigger() {
  const text = 'New rule \u2014 fire on which kind of alert?';
  const keyboard = [
    [{ text: '\uD83D\uDD14 Any alert', callback_data: 'rulewiz:trig:any_alert' }],
    [{ text: '\uD83D\uDCC8 Threshold', callback_data: 'rulewiz:trig:threshold' }],
    [{ text: '\uD83C\uDFC1 Milestone', callback_data: 'rulewiz:trig:milestone' }],
    ...footer('nav:rules'),
  ];
  return { text, keyboard };
}

function ruleWizardCoin(s) {
  const text = `${describeRuleSoFar(s)}Which coin should trigger it?`;
  const extraRows = [[{ text: '\uD83C\uDF10 Any coin', callback_data: 'rulewiz:coin:any' }]];
  return { text, keyboard: coinGrid('rulewiz:coin', { extraRows, parentCallback: 'nav:rules' }) };
}

function ruleWizardDirection(s) {
  const text = `${describeRuleSoFar(s)}Only fire on one direction?`;
  const keyboard = [
    [{ text: '\u2194\uFE0F Either', callback_data: 'rulewiz:dir:any' }],
    [
      { text: '\uD83D\uDFE2 Up only', callback_data: 'rulewiz:dir:up' },
      { text: '\uD83D\uDD34 Down only', callback_data: 'rulewiz:dir:down' },
    ],
    ...footer('nav:rules'),
  ];
  return { text, keyboard };
}

function ruleWizardMinMove(s) {
  const text = `${describeRuleSoFar(s)}Minimum move size to fire? (only applies to threshold/any-alert triggers \u2014 milestone alerts have no % to compare)`;
  const presets = ['1', '2', '5', '10'];
  const buttons = presets.map((p) => ({ text: `${p}%+`, callback_data: `rulewiz:min:${p}` }));
  const keyboard = [
    [{ text: 'No minimum', callback_data: 'rulewiz:min:none' }],
    ...chunk(buttons, 4),
    [{ text: '\u270F\uFE0F Custom %', callback_data: 'rulewiz:min:custom' }],
    ...footer('nav:rules'),
  ];
  return { text, keyboard };
}

function ruleWizardAction(s) {
  const text = `${describeRuleSoFar(s)}What should happen when it fires?`;
  const keyboard = [
    [{ text: '\uD83D\uDD01 Mirror to another channel', callback_data: 'rulewiz:act:mirror' }],
    [{ text: '\uD83D\uDCC8 Post a chart', callback_data: 'rulewiz:act:post_chart' }],
    [{ text: '\uD83D\uDCE2 Broadcast a message', callback_data: 'rulewiz:act:broadcast' }],
    [{ text: '\uD83D\uDD07 Mute another coin', callback_data: 'rulewiz:act:mute_coin' }],
    ...footer('nav:rules'),
  ];
  return { text, keyboard };
}

function ruleWizardChannel(s, channels) {
  const text = `${describeRuleSoFar(s)}Which channel?`;
  return { text, keyboard: channelPicker('rulewiz:chan', channels, [backRow('nav:rules')]) };
}

function ruleWizardPeriod(s) {
  const text = `${describeRuleSoFar(s)}Chart period?`;
  const periods = ['1h', '24h', '7d', '30d'];
  const buttons = periods.map((p) => ({ text: p, callback_data: `rulewiz:per:${p}` }));
  const keyboard = [...chunk(buttons, 4), ...footer('nav:rules')];
  return { text, keyboard };
}

function ruleWizardMuteCoin(s) {
  const text = `${describeRuleSoFar(s)}Mute which coin?`;
  return { text, keyboard: coinGrid('rulewiz:mcoin', { parentCallback: 'nav:rules' }) };
}

function ruleWizardMuteDuration(s) {
  const text = `${describeRuleSoFar(s)}Mute for how long?`;
  return { text, keyboard: durationPicker('rulewiz:mdur', [backRow('nav:rules')]) };
}

function ruleWizardConfirm(s) {
  const text = `${describeRuleSoFar(s)}Create this rule?`;
  const keyboard = [
    [
      { text: '\u2705 Create', callback_data: 'rulewiz:confirm' },
      { text: '\u2716 Cancel', callback_data: 'rulewiz:cancel' },
    ],
  ];
  return { text, keyboard };
}

// ---------- Coin tags/groups ----------
function tagsList(tags) {
  const text = tags.length
    ? `Tags\n${tags.map((t) => `#${t.tag} \u2014 ${t.coinCount} coin(s)`).join('\n')}`
    : 'No tags yet. Tag a coin to create one (e.g. /tag BTC layer1), or use the button below.';
  const tagRows = chunk(
    tags.map((t) => ({ text: `#${t.tag}`, callback_data: `tag:view:${t.tag}` })),
    2
  );
  const keyboard = [...tagRows, [{ text: '\u2795 Tag a coin', callback_data: 'tag:addstart' }], HOME_ROW];
  return { text, keyboard };
}

function tagDetail(tag, symbols) {
  const text = symbols.length ? `#${tag}\n${symbols.join(', ')}` : `#${tag} has no coins (all untagged from it).`;
  const keyboard = [[{ text: '\u2795 Tag a coin', callback_data: 'tag:addstart' }], ...footer('nav:tags')];
  return { text, keyboard };
}

function tagAddCoinPicker() {
  const text = 'Which coin do you want to tag?';
  return { text, keyboard: coinGrid('tag:addcoin', { parentCallback: 'nav:tags' }) };
}

// ---------- Bulk actions ----------
function bulkWizardSummary(s) {
  const bits = [];
  if (s.actionType) bits.push(`Action: ${s.actionType === 'threshold' ? 'Set threshold' : 'Mute'}`);
  if (s.scope) bits.push(`Scope: ${s.scope === 'all' ? 'all coins' : `#${s.scope.tag}`}`);
  return bits.join(' \u00B7 ');
}

function bulkWizardAction() {
  const text = 'Bulk actions \u2014 what do you want to apply to a group of coins at once?';
  const keyboard = [
    [{ text: '\uD83C\uDFAF Set threshold', callback_data: 'bulk:act:threshold' }],
    [{ text: '\uD83D\uDD07 Mute', callback_data: 'bulk:act:mute' }],
    ...footer('nav:automation'),
  ];
  return { text, keyboard };
}

function bulkWizardScope(s, tags) {
  const text = `${bulkWizardSummary(s)}\n\nApply to which coins?`;
  const tagButtons = tags.map((t) => ({ text: `#${t.tag} (${t.coinCount})`, callback_data: `bulk:scope:tag:${t.tag}` }));
  const keyboard = [
    [{ text: '\uD83C\uDF10 All coins', callback_data: 'bulk:scope:all' }],
    ...chunk(tagButtons, 2),
    ...footer('nav:automation'),
  ];
  return { text, keyboard };
}

function bulkWizardMuteDuration(s) {
  const text = `${bulkWizardSummary(s)}\n\nMute for how long?`;
  return { text, keyboard: durationPicker('bulk:mutedur', [backRow('nav:automation')]) };
}

function moversChannelPicker(tagArg, channels) {
  const text = 'Post this movers summary to which channel?';
  return { text, keyboard: channelPicker(`movers:postto:${tagArg}`, channels, [backRow('nav:movers')]) };
}

// ---------- Markets hub ----------
function marketsHub({ categories, uncategorizedCount }) {
  const text = '\uD83D\uDC8E PricePing Markets';
  const catRows = categories.map((c) => [{ text: `${c.emoji} ${c.label} (${c.count})`, callback_data: `markets:cat:${c.tag}` }]);
  const keyboard = [
    [{ text: '\uD83D\uDFE0 TOP 20', callback_data: 'markets:top20' }],
    ...catRows,
    ...(uncategorizedCount ? [[{ text: `\u26AA Uncategorized (${uncategorizedCount})`, callback_data: 'markets:cat:uncategorized' }]] : []),
    [
      { text: '\uD83D\uDCC8 Top Gainers', callback_data: 'markets:gainers' },
      { text: '\uD83D\uDCC9 Top Losers', callback_data: 'markets:losers' },
    ],
    [{ text: '\u2B50 My Watchlist', callback_data: 'markets:watchlist' }],
    [{ text: '\uD83D\uDD04 Refresh classification', callback_data: 'markets:reclassify' }],
    ...footer('nav:hub'),
  ];
  return { text, keyboard };
}

// rows: [{symbol, price}] — price may be undefined if Binance was
// unreachable, still shown (just without a price line) rather than
// dropping the coin from the list.
function marketsCoinList(label, rows, backTarget) {
  const lines = rows.map((r) => (r.price !== undefined ? `${r.symbol.padEnd(6, ' ')} $${format.formatPrice(r.price)}` : r.symbol));
  const text = `${label} (${rows.length})\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines.join('\n')}`;
  const coinButtons = rows.map((r) => ({ text: r.symbol, callback_data: `coin:settings:${r.symbol}` }));
  const keyboard = [...chunk(coinButtons, 4), [{ text: '\u25C0 Back', callback_data: backTarget }], HOME_ROW];
  return { text, keyboard };
}

// ---------- Multi-select coin picker (tap to check/uncheck in place) ----------
// A third way to scope a bulk action, alongside "all coins" and "one tag"
// (see bulkWizard* above) — pick an arbitrary ad-hoc set by tapping.
function coinSelect(coins, selected) {
  const selectedSet = new Set(selected);
  const text = `Select coins (${selected.length} selected) \u2014 tap to toggle, then pick an action.`;
  const coinButtons = coins.map((c) => ({
    text: `${selectedSet.has(c.symbol) ? '\u2705' : '\u2B1C'} ${c.symbol}`,
    callback_data: `coinselect:toggle:${c.symbol}`,
  }));
  const keyboard = [
    ...chunk(coinButtons, 3),
    [
      { text: `\uD83D\uDDD1 Remove (${selected.length})`, callback_data: 'coinselect:remove' },
      { text: `\uD83D\uDD07 Mute (${selected.length})`, callback_data: 'coinselect:mutestart' },
    ],
    [{ text: `\uD83C\uDFAF Set threshold (${selected.length})`, callback_data: 'coinselect:thresholdstart' }],
    [
      { text: '\u2716 Clear', callback_data: 'coinselect:clear' },
      { text: '\u2705 Done', callback_data: 'coinselect:done' },
    ],
    HOME_ROW,
  ];
  return { text, keyboard };
}

function coinSelectMuteDuration(selectedCount) {
  const text = `Mute ${selectedCount} selected coin(s) for how long?`;
  return { text, keyboard: durationPicker('coinselect:mutedur', [backRow('coinselect:start')]) };
}

// ---------- Channels ----------
function channelList(channels, defaultsByType) {
  const lines = channels.length
    ? channels.map((c) => `${c.isDefault ? '\u2B50' : '  '} ${c.name.padEnd(10, ' ')} ${c.chatId}`).join('\n')
    : 'No channels registered.';

  const typeEntries = Object.entries(defaultsByType || {});
  const typeLines = typeEntries.map(([type, name]) => `${type} \u2192 #${name}`).join('\n');

  const text =
    `Channels\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\n\u2B50 = overall default` +
    (typeLines ? `\n\nPer-type overrides:\n${typeLines}` : '');
  const rows = channels
    .filter((c) => !c.isDefault)
    .map((c) => [
      { text: `\u2B50 Make ${c.name} default`, callback_data: `channel:setdefault:${c.name}` },
      { text: `\u2716 Remove`, callback_data: `channel:del:${c.name}` },
    ]);
  const clearTypeRows = typeEntries.map(([type]) => [{ text: `\u2716 Clear ${type} default`, callback_data: `channel:cleartypedefault:${type}` }]);
  const keyboard = [
    ...rows,
    ...clearTypeRows,
    [{ text: '\u2795 Add channel', callback_data: 'channel:add' }],
    [{ text: '\uD83C\uDFAF Set per-type default', callback_data: 'channel:typedefault' }],
    [{ text: '\uD83D\uDCE2 Broadcast', callback_data: 'nav:broadcastmenu' }],
    ...footer('nav:hub'),
  ];
  return { text, keyboard };
}

function channelTypePicker() {
  const text = 'Set a default channel for which alert type?';
  const types = ['threshold', 'milestone', 'manual', 'chart', 'digest'];
  const buttons = types.map((t) => ({ text: t, callback_data: `channel:typedefault:${t}` }));
  return { text, keyboard: [...chunk(buttons, 2), ...footer('nav:channels')] };
}

function channelTypeDefaultPicker(alertType, channels) {
  const text = `Default channel for "${alertType}" alerts?`;
  return { text, keyboard: channelPicker(`channel:settypedefault:${alertType}`, channels, [backRow('channel:typedefault')]) };
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
  return {
    text,
    keyboard: [
      ...chunk(buttons, 2),
      [{ text: '\uD83C\uDFA8 Apply a caption pack', callback_data: 'nav:captionpacks' }],
      [{ text: '\uD83D\uDCD6 Variables', callback_data: 'nav:variables' }],
      ...footer('nav:hub'),
    ],
  };
}

function captionPackMenu(packNames) {
  const text = 'Caption packs \u2014 apply one to all four alert types at once. You can still fine-tune any of them afterward.';
  const buttons = packNames.map((name) => ({ text: name, callback_data: `captionpack:apply:${name}` }));
  return { text, keyboard: [...chunk(buttons, 2), ...footer('nav:captiontypes')] };
}

function captionDetail(alertType, currentTemplate, isCustom) {
  const text =
    `Caption \u2014 ${alertType}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `${isCustom ? '(custom)' : '(default)'}\n\n${currentTemplate}`;
  const keyboard = [
    [{ text: '\u270F Edit', callback_data: `caption:edit:${alertType}` }],
    [{ text: '\uD83D\uDC41 Preview', callback_data: `caption:preview:${alertType}` }],
    isCustom ? [{ text: '\u21A9 Reset to default', callback_data: `caption:reset:${alertType}` }] : [],
    [{ text: '\uD83E\uDE99 Per-coin overrides', callback_data: `caption:overrides:${alertType}` }],
    [{ text: '\uD83D\uDCD6 Variables', callback_data: 'nav:variables' }],
    ...footer('nav:captiontypes'),
  ].filter((row) => row.length);
  return { text, keyboard };
}

function captionCoinPicker(alertType, recentSymbols = []) {
  const text = `Per-coin override for "${alertType}" \u2014 pick a coin:`;
  return { text, keyboard: coinGrid(`caption:coinpick:${alertType}`, { recentSymbols, parentCallback: `caption:type:${alertType}` }) };
}

function captionCoinDetail(alertType, symbol, currentTemplate, isCustom) {
  const text =
    `Caption \u2014 ${alertType}:${symbol}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `${isCustom ? '(custom override)' : `(no override set \u2014 using the shared "${alertType}" template)`}\n\n${currentTemplate}`;
  const keyboard = [
    [{ text: '\u270F Edit', callback_data: `caption:coinedit:${alertType}:${symbol}` }],
    [{ text: '\uD83D\uDC41 Preview', callback_data: `caption:coinpreview:${alertType}:${symbol}` }],
    isCustom ? [{ text: '\u21A9 Reset (remove override)', callback_data: `caption:coinreset:${alertType}:${symbol}` }] : [],
    ...footer(`caption:overrides:${alertType}`),
  ].filter((row) => row.length);
  return { text, keyboard };
}

function variablesHelp(docs) {
  const lines = docs.map((g) => `${g.group}:\n  ${g.vars.map((v) => `{${v}}`).join('  ')}`).join('\n\n');
  const text =
    `Available caption variables\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}\n\n` +
    `A line containing a variable that doesn't apply (e.g. {change_pct} on a milestone alert) is dropped automatically \u2014 no need for if/else syntax.`;
  const keyboard = [[{ text: '\uD83D\uDD27 My custom variables', callback_data: 'nav:varsmanage' }], ...footer('nav:captiontypes')];
  return { text, keyboard };
}

// ---------- Coin settings entry grid (from hub) ----------
function coinSettingsMenu(recentSymbols = []) {
  const text = 'Coin settings \u2014 pick a coin (threshold, milestone, cooldown, mute in one screen):';
  const keyboard = coinGrid('coin:settings', {
    recentSymbols,
    extraRows: [
      [
        { text: '\uD83C\uDFAF All milestones', callback_data: 'nav:milestones' },
        { text: '\uD83D\uDCCB View all coins', callback_data: 'nav:coinlist' },
      ],
      [
        { text: '\u2795 Add coin', callback_data: 'addcoin:start' },
        { text: '\u2611 Select multiple', callback_data: 'coinselect:start' },
      ],
    ],
  });
  return { text, keyboard };
}

// List every tracked coin, marking which were added via /addcoin (and are
// therefore removable) vs. the 10 the bot ships with.
function coinList(coins, customSymbols) {
  const lines = coins.map((c) => `${c.symbol.padEnd(6, ' ')} ${c.name}${customSymbols.has(c.symbol) ? '  (custom)' : ''}`);
  const text = `Tracked coins (${coins.length})\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines.join('\n')}\n\nCustom coins can be removed \u2014 pick one below.`;
  const customButtons = coins
    .filter((c) => customSymbols.has(c.symbol))
    .map((c) => ({ text: `\u2716 ${c.symbol}`, callback_data: `removecoin:pick:${c.symbol}` }));
  const keyboard = [...chunk(customButtons, 3), ...footer('nav:coinsettings')];
  return { text, keyboard };
}

function removeCoinConfirm(symbol) {
  const text = `Remove ${symbol}? This stops tracking it, and clears its threshold/tags. This can't be undone \u2014 you'd need to /addcoin it again from scratch.`;
  const keyboard = [
    [
      { text: '\u2705 Confirm remove', callback_data: 'removecoin:confirm' },
      { text: '\u274C Cancel', callback_data: 'removecoin:cancel' },
    ],
    HOME_ROW,
  ];
  return { text, keyboard };
}

function removeCoinConfirmBatch(removable, notTracked, notCustom) {
  const lines = [`Remove ${removable.length} coin(s)? ${removable.join(', ')}`, 'Stops tracking each, clears their threshold/tags. Can\u2019t be undone.'];
  if (notTracked.length) lines.push(`\nNot tracked, will be skipped: ${notTracked.join(', ')}`);
  if (notCustom.length) lines.push(`\nBuilt-in, can't remove this way, will be skipped: ${notCustom.join(', ')}`);
  const keyboard = [
    [
      { text: `\u2705 Confirm remove (${removable.length})`, callback_data: 'removecoin:confirm' },
      { text: '\u274C Cancel', callback_data: 'removecoin:cancel' },
    ],
    HOME_ROW,
  ];
  return { text: lines.join('\n'), keyboard };
}

// ---------- History ----------
function historyMenu(recentSymbols = []) {
  const text = 'History \u2014 pick a coin:';
  return { text, keyboard: coinGrid('history:coin', { recentSymbols }) };
}

function historyDetail(symbol, lines, channels, activeChannel, offset = 0, total = 0, pageSize = 10) {
  const rangeLabel = total > pageSize ? ` (${offset + 1}-${Math.min(offset + pageSize, total)} of ${total})` : '';
  const text =
    `Recent ${symbol} activity${activeChannel ? ` (#${activeChannel})` : ''}${rangeLabel}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    (lines.length ? lines.join('\n') : 'No alerts logged yet.');

  const filterButtons = channels
    .filter((c) => c.name !== activeChannel)
    .map((c) => ({ text: `#${c.name}`, callback_data: `history:filter:${symbol}:${c.name}:0` }));
  const allRow = activeChannel ? [[{ text: '\uD83D\uDD04 All channels', callback_data: `history:coin:${symbol}:0` }]] : [];

  const pageRow = [];
  if (offset > 0) {
    pageRow.push({ text: '\u25C0 Newer', callback_data: `history:filter:${symbol}:${activeChannel || '-'}:${Math.max(offset - pageSize, 0)}` });
  }
  if (offset + pageSize < total) {
    pageRow.push({ text: 'Older \u25B6', callback_data: `history:filter:${symbol}:${activeChannel || '-'}:${offset + pageSize}` });
  }

  return { text, keyboard: [...allRow, ...chunk(filterButtons, 2), ...(pageRow.length ? [pageRow] : []), ...footer('nav:history')] };
}

// ---------- Custom variables management ----------
function varsList(varsMap) {
  const entries = Object.entries(varsMap);
  const text = `Your custom variables\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${
    entries.length ? entries.map(([name, value]) => `{${name}} \u2192 ${value}`).join('\n') : 'None set yet.'
  }`;
  const delButtons = entries.map(([name]) => ({ text: `\u2716 {${name}}`, callback_data: `var:del:${name}` }));
  return { text, keyboard: [...chunk(delButtons, 2), [{ text: '\u2795 Add variable', callback_data: 'var:add' }], ...footer('nav:variables')] };
}

// ---------- Quick actions (pins) ----------
function pinManage(pinnedKeys) {
  const text =
    `Quick actions\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Pick up to 3 to pin as a row on Home.\n` +
    `Pinned: ${pinnedKeys.length ? pinnedKeys.join(', ') : 'none'}`;
  const buttons = PINNABLE_ACTIONS.map((a) => ({
    text: `${pinnedKeys.includes(a.key) ? '\u2705' : '\u2B1C'} ${a.label}`,
    callback_data: `pin:toggle:${a.key}`,
  }));
  return { text, keyboard: [...chunk(buttons, 2), ...footer('nav:settings')] };
}

// ---------- Usage analytics ----------
function usageList(rows) {
  const lines = rows.length
    ? rows.slice(0, 20).map((r) => `/${r.command}  \u00D7${r.count}  (last ${format.timeAgo(r.last_used_at)})`).join('\n')
    : 'No command usage recorded yet.';
  const text = `Command usage\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}`;
  return { text, keyboard: footer('nav:settings') };
}

// ---------- Audit log ----------
function auditLog(rows) {
  const lines = rows.length
    ? rows.map((r) => `${format.timeAgo(r.created_at)}  ${r.message}`).join('\n')
    : 'No changes logged yet.';
  const text = `Audit log \u2014 recent config changes\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${lines}`;
  return { text, keyboard: footer('nav:settings') };
}

// ---------- Backup ----------
function backupMenu() {
  const text = 'Backup \u2014 export every setting as a JSON file, or restore from a previous export.';
  const keyboard = [
    [{ text: '\uD83D\uDCE4 Export', callback_data: 'backup:export' }],
    [{ text: '\uD83D\uDCE5 Import', callback_data: 'backup:import' }],
    ...footer('nav:settings'),
  ];
  return { text, keyboard };
}
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
function addCoinConfirm({ symbol, name, pair, color }, warning = '') {
  const text = `Add this coin?\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nSymbol  ${symbol}\nName    ${name}\nPair    ${pair}\nColor   ${color}${warning}`;
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
function settings({ compactCards = false, quietHours = null } = {}) {
  const text =
    `Settings\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
    `Poll interval     ${config.pollIntervalMs / 1000}s\n` +
    `Cooldown default  ${config.cooldownMinutes}m per coin\n` +
    `Hourly send cap   ${config.maxAlertsPerHour}\n` +
    `Memory limit      ${config.memoryLimitMb}MB\n` +
    `Card style        ${compactCards ? 'compact' : 'full'}\n` +
    `Quiet hours       ${quietHours ? `${quietHours.startHourUtc}:00-${quietHours.endHourUtc}:00 UTC` : 'off'}\n\n` +
    `Poll/cooldown/cap/memory are environment variables (next restart). ` +
    `Everything else here \u2014 card style, quiet hours (/quiethours), channels, captions, thresholds, milestones, cooldowns, schedules, and rules \u2014 is live, see /commands.`;
  const keyboard = [
    [
      { text: '\u2B50 Quick actions', callback_data: 'nav:pins' },
      { text: '\uD83D\uDCBE Backup', callback_data: 'nav:backup' },
    ],
    [
      { text: '\uD83D\uDCCB Audit log', callback_data: 'nav:auditlog' },
      { text: '\uD83D\uDCC8 Usage stats', callback_data: 'nav:usage' },
    ],
    [{ text: compactCards ? '\uD83D\uDDBC Switch to full cards' : '\uD83D\uDDBC Switch to compact cards', callback_data: 'action:cardstyletoggle' }],
    [{ text: '\uD83D\uDC64 Who am I', callback_data: 'nav:whoami' }],
    HUB_ROW,
    HOME_ROW,
  ];
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
  chartStylePicker,
  chartPeriodPicker,
  chartChannelPicker,
  thresholds,
  thresholdEdit,
  coinSettings,
  coinSettingsMenu,
  coinList,
  removeCoinConfirm,
  removeCoinConfirmBatch,
  milestoneList,
  muteMenu,
  muteDurationPicker,
  pauseMenu,
  automationHub,
  scheduleList,
  ruleList,
  ruleWizardTrigger,
  ruleWizardCoin,
  ruleWizardDirection,
  ruleWizardMinMove,
  ruleWizardAction,
  ruleWizardChannel,
  ruleWizardPeriod,
  ruleWizardMuteCoin,
  ruleWizardMuteDuration,
  ruleWizardConfirm,
  tagsList,
  tagDetail,
  tagAddCoinPicker,
  bulkWizardAction,
  bulkWizardScope,
  bulkWizardMuteDuration,
  bulkWizardSummary,
  moversChannelPicker,
  marketsHub,
  marketsCoinList,
  coinSelect,
  coinSelectMuteDuration,
  channelList,
  channelTypePicker,
  channelTypeDefaultPicker,
  broadcastChannelPicker,
  captionTypes,
  captionDetail,
  captionCoinPicker,
  captionCoinDetail,
  variablesHelp,
  varsList,
  historyMenu,
  historyDetail,
  pinManage,
  captionPackMenu,
  usageList,
  auditLog,
  backupMenu,
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
