const { Markup } = require('telegraf');
const style = require('./buttonStyle');
const modes = require('../services/modes');

// Every submenu below ends with a nav row: ⬅️ Back to its real parent, and
// 🏠 Main Menu as the escape hatch — both, per design.
function navRow(backData, backLabel = '⬅️ Back') {
  return [style.callback(backLabel, backData, style.BLUE), style.callback('🏠 Main Menu', 'menu:root', style.BLUE)];
}

const mainMenu = Markup.inlineKeyboard([
  [style.callback('📡 Watching', 'menu:watching', style.BLUE)],
  [style.callback('📤 Broadcasting', 'menu:broadcasting', style.BLUE)],
  [style.callback('🤖 Automation', 'menu:automation', style.BLUE)],
  [style.callback('🛠️ Bot', 'menu:bot', style.BLUE)],
]);

// --- 📡 Watching ------------------------------------------------------------

const watchingHub = Markup.inlineKeyboard([
  [style.callback('🪙 Tracked Coins', 'watching:coins:1', style.BLUE)],
  [style.callback('🎯 Thresholds', 'watching:thresholds', style.BLUE)],
  [style.callback('🔄 Force Sync Now', 'watching:sync')],
  navRow('menu:root', '🏠 Main Menu').slice(0, 1), // Watching IS a top-level hub, so just Main Menu, no duplicate Back
]);

function coinList(coins, page, totalPages) {
  const rows = coins.map((c) => [style.callback(`${c.muted ? '🔕' : '🪙'} ${c.symbol}`, `coin:view:${c.symbol}`, style.BLUE)]);
  const pagination = [];
  if (page > 1) pagination.push(style.callback('⬅️ Prev', `watching:coins:${page - 1}`));
  if (page < totalPages) pagination.push(style.callback('Next ➡️', `watching:coins:${page + 1}`));
  if (pagination.length) rows.push(pagination);
  rows.push(navRow('menu:watching', '⬅️ Back to Watching'));
  return Markup.inlineKeyboard(rows);
}

function coinDetail(coin) {
  return Markup.inlineKeyboard([
    [style.callback('✏️ Override Threshold', `coin:threshold:${coin.symbol}`, style.BLUE)],
    [style.callback('🔁 Re-fetch Logo', `coin:relogo:${coin.symbol}`)],
    [style.callback(coin.muted ? '🔔 Unmute' : '🔕 Mute Coin', `coin:mute:${coin.symbol}`)],
    navRow('watching:coins:1', '⬅️ Back to Coins'),
  ]);
}

const thresholdsMenu = Markup.inlineKeyboard([
  [style.callback('✏️ Major Tier %', 'threshold:edit:major', style.BLUE)],
  [style.callback('✏️ Mid Tier %', 'threshold:edit:mid', style.BLUE)],
  [style.callback('✏️ Micro Tier %', 'threshold:edit:micro', style.BLUE)],
  [style.callback('📋 View Overrides', 'threshold:overrides')],
  navRow('menu:watching', '⬅️ Back to Watching'),
]);

// --- 📤 Broadcasting ---------------------------------------------------------

const broadcastingHub = Markup.inlineKeyboard([
  [style.callback('📺 Channels', 'broadcasting:channels', style.BLUE)],
  [style.callback('✍️ Post Format', 'broadcasting:format', style.BLUE)],
  [style.callback('📈 Manual Post', 'post:new', style.BLUE)],
  [style.callback('🏠 Main Menu', 'menu:root', style.BLUE)],
]);

function channelList(channels) {
  const rows = channels.map((c) => [
    style.callback(`${c.is_default ? '⭐' : '📺'} ${c.name}`, `channel:view:${c.name}`, style.BLUE),
  ]);
  rows.push([style.callback('➕ Add Channel', 'channel:add', style.BLUE)]);
  rows.push(navRow('menu:broadcasting', '⬅️ Back to Broadcasting'));
  return Markup.inlineKeyboard(rows);
}

function channelDetail(channel, toggles) {
  const postTypes = [
    ['threshold', 'Threshold Alerts'],
    ['milestone', 'Milestones'],
    ['chart', 'Charts'],
    ['movers', 'Movers'],
    ['feargreed', 'Fear & Greed'],
    ['digest', 'Digests'],
  ];
  const rows = postTypes.map(([key, label]) => [
    style.callback(`${toggles[key] ? '✅' : '⬜'} ${label}`, `channel:toggle:${channel.name}:${key}`),
  ]);
  if (!channel.is_default) {
    rows.push([style.callback('🗑️ Remove Channel', `channel:remove:confirm:${channel.name}`, style.RED)]);
  }
  rows.push(navRow('broadcasting:channels', '⬅️ Back to Channels'));
  return Markup.inlineKeyboard(rows);
}

function channelRemoveConfirm(name) {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Remove', `channel:remove:do:${name}`, style.RED)],
    [style.callback('❌ Cancel', `channel:view:${name}`, style.GREEN)],
  ]);
}

const postFormatMenu = Markup.inlineKeyboard([
  [style.callback('Threshold', 'format:edit:threshold', style.BLUE)],
  [style.callback('Milestone', 'format:edit:milestone', style.BLUE)],
  [style.callback('Manual Post', 'format:edit:manual', style.BLUE)],
  [style.callback('Chart', 'format:edit:chart', style.BLUE)],
  navRow('menu:broadcasting', '⬅️ Back to Broadcasting'),
]);

function postFormatDetail(alertType) {
  return Markup.inlineKeyboard([
    [style.callback('✏️ Edit', `format:setnew:${alertType}`, style.BLUE)],
    [style.callback('🔁 Reset to Default', `format:reset:${alertType}`)],
    [style.callback('👁️ Preview', `format:preview:${alertType}`)],
    navRow('broadcasting:format', '⬅️ Back to Post Format'),
  ]);
}

// --- 🤖 Automation ------------------------------------------------------------

const automationHub = Markup.inlineKeyboard([
  [style.callback('📊 Scheduled Posts', 'automation:scheduled', style.BLUE)],
  [style.callback('📅 Digests', 'automation:digests', style.BLUE)],
  [style.callback('⚡ Mode Details', 'automation:modedetails', style.BLUE)],
  [style.callback('🏠 Main Menu', 'menu:root', style.BLUE)],
]);

const scheduledPostsMenu = Markup.inlineKeyboard([
  [style.callback('📈 Charts', 'scheduled:view:chart', style.BLUE)],
  [style.callback('📊 Movers', 'scheduled:view:movers', style.BLUE)],
  [style.callback('😨 Fear & Greed', 'scheduled:view:feargreed', style.BLUE)],
  navRow('menu:automation', '⬅️ Back to Automation'),
]);

const digestsMenu = Markup.inlineKeyboard([
  [style.callback('📅 Daily Digest', 'digest:view:daily', style.BLUE)],
  [style.callback('📅 Weekly Digest', 'digest:view:weekly', style.BLUE)],
  [style.callback('👁️ Preview Digest', 'digest:preview')],
  navRow('menu:automation', '⬅️ Back to Automation'),
]);

async function modePicker() {
  const current = await modes.getCurrentModeKey();
  const rows = modes.MODE_ORDER.map((key) => {
    const mode = modes.MODE_DEFS[key];
    const prefix = key === current ? '✓ ' : '';
    return [style.callback(`${prefix}${mode.label}`, `mode:set:${key}`)];
  });
  rows.push(navRow('menu:root', '🏠 Main Menu').slice(0, 1));
  return Markup.inlineKeyboard(rows);
}

const modeDetailsBack = Markup.inlineKeyboard([
  [style.callback('🔁 Switch Mode', 'mode:picker')],
  navRow('menu:automation', '⬅️ Back to Automation'),
]);

// --- 🛠️ Bot --------------------------------------------------------------

const botHub = Markup.inlineKeyboard([
  [style.callback('🌍 Timezone', 'bot:timezone', style.BLUE)],
  [style.callback('📊 Status & Health', 'bot:status', style.BLUE)],
  [style.callback('🏠 Main Menu', 'menu:root', style.BLUE)],
]);

const timezoneScreen = Markup.inlineKeyboard([
  [style.callback('✏️ Set Timezone', 'bot:timezone:set', style.BLUE)],
  navRow('menu:bot', '⬅️ Back to Bot'),
]);

const statusScreen = Markup.inlineKeyboard([
  [style.callback('🔄 Refresh', 'bot:status', style.BLUE)],
  navRow('menu:bot', '⬅️ Back to Bot'),
]);

// --- 📈 Manual Post flow ------------------------------------------------------

function manualPostCoinList(coins, page, totalPages) {
  const rows = coins.map((c) => [style.callback(`${c.symbol}`, `post:coin:${c.symbol}`, style.BLUE)]);
  const pagination = [];
  if (page > 1) pagination.push(style.callback('⬅️ Prev', `post:coinpage:${page - 1}`));
  if (page < totalPages) pagination.push(style.callback('Next ➡️', `post:coinpage:${page + 1}`));
  if (pagination.length) rows.push(pagination);
  rows.push([style.callback('🔍 Search by Symbol', 'post:search', style.BLUE)]);
  rows.push(navRow('menu:broadcasting', '⬅️ Back to Broadcasting'));
  return Markup.inlineKeyboard(rows);
}

function manualPostTypeChoice(symbol) {
  return Markup.inlineKeyboard([
    [style.callback('💳 Price Card', `post:type:card:${symbol}`, style.BLUE)],
    [style.callback('📈 Chart', `post:type:chart:${symbol}`, style.BLUE)],
    navRow('post:new', '⬅️ Back to Coin List'),
  ]);
}

function manualPostChartStyle(symbol) {
  return Markup.inlineKeyboard([
    [style.callback('📈 Line', `post:chartstyle:line:${symbol}`, style.BLUE)],
    [style.callback('🕯️ Candles', `post:chartstyle:candle:${symbol}`, style.BLUE)],
    navRow(`post:coin:${symbol}`, '⬅️ Back'),
  ]);
}

function manualPostChartPeriod(symbol, chartStyle) {
  const periods = [
    ['1h', 'Last 1 hour'],
    ['24h', 'Last 24 hours'],
    ['7d', 'Last 7 days'],
    ['30d', 'Last 30 days'],
  ];
  const rows = periods.map(([key, label]) => [style.callback(label, `post:period:${chartStyle}:${key}:${symbol}`)]);
  rows.push(navRow(`post:type:chart:${symbol}`, '⬅️ Back'));
  return Markup.inlineKeyboard(rows);
}

function manualPostChannelChoice(kindKey, channels) {
  const rows = channels.map((c) => [style.callback(`📺 ${c.name}`, `post:send:${kindKey}:${c.name}`, style.BLUE)]);
  rows.push([style.callback('📢 All Channels', `post:send:${kindKey}:__all__`, style.BLUE)]);
  rows.push(navRow('post:new', '⬅️ Back'));
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  navRow,
  mainMenu,
  watchingHub,
  coinList,
  coinDetail,
  thresholdsMenu,
  broadcastingHub,
  channelList,
  channelDetail,
  channelRemoveConfirm,
  postFormatMenu,
  postFormatDetail,
  automationHub,
  scheduledPostsMenu,
  digestsMenu,
  modePicker,
  modeDetailsBack,
  botHub,
  timezoneScreen,
  statusScreen,
  manualPostCoinList,
  manualPostTypeChoice,
  manualPostChartStyle,
  manualPostChartPeriod,
  manualPostChannelChoice,
};
