const { Telegraf } = require('telegraf');
const config = require('./config');
const { sessionMiddleware } = require('./middleware/redisSessionStore');
const logger = require('./lib/logger');
const navStack = require('./lib/navStack');
const replyKb = require('./keyboards/replyKeyboards');

const startHandler = require('./handlers/start');
const settingsHandler = require('./handlers/settings');
const timezoneHandler = require('./handlers/timezone');
const channelSettingsHandler = require('./handlers/channelSettings');
const coinListHandler = require('./handlers/coinList');
const coinPanelHandler = require('./handlers/coinPanel');
const bulkActionsHandler = require('./handlers/bulkActions');
const chartsHandler = require('./handlers/charts');
const fearGreedHandler = require('./handlers/fearGreed');
const channelsHandler = require('./handlers/channels');
const manageChannelsHandler = require('./handlers/manageChannels');
const manualPostHandler = require('./handlers/manualPost');
const captionSettingsHandler = require('./handlers/captionSettings');

// Resolves "which channel's settings is this user editing" when a callback
// doesn't already carry an explicit channelId. For now, DMs operate on the
// user's own personal channel-equivalent config row (id 0) — full
// multi-channel switching (picking which admin'd channel to configure) is
// a follow-up screen; this keeps single-channel/personal use fully working
// today. Most routes below carry channelId explicitly in the callback data
// (see coinList.js's scheme) since that's more robust than session state
// alone across long-lived conversations.
async function resolveChannelId(ctx) {
  return ctx.session.activeChannelId || 0;
}

function createBot() {
  const bot = new Telegraf(config.BOT_TOKEN);
  bot.use(sessionMiddleware());

  // --- Commands: ONLY /start /help /settings, per the "no command sprawl" rule ---
  bot.start(startHandler.handleStart);
  bot.help(startHandler.handleHelp);
  bot.command('settings', settingsHandler.showSettings);

  // --- Reply keyboard (Home menu) text routes ---
  bot.hears('📊 Prices', (ctx) => coinListHandler.showCoinList(ctx, { page: 0, mode: 'view' }));
  bot.hears('📈 Charts', chartsHandler.showChartMenu);
  bot.hears('🐋 Milestones', (ctx) => coinListHandler.showCoinList(ctx, { page: 0, mode: 'view' }));
  bot.hears('😨 Fear & Greed', fearGreedHandler.showFearGreed);
  bot.hears('⚙️ Settings', settingsHandler.showSettings);
  bot.hears('ℹ️ Help', startHandler.handleHelp);

  // --- my_chat_member: bot added/removed/promoted in a channel ---
  bot.on('my_chat_member', channelsHandler.handleMyChatMember);

  // --- Text input router: numeric prompts (threshold/milestone/cooldown/
  // custom timezone) take priority over anything else while pending ---
  bot.on('text', async (ctx, next) => {
    if (ctx.session.awaitingCustomTimezone) {
      const handled = await timezoneHandler.handleCustomInput(ctx, ctx.message.text);
      if (handled) return;
    }
    if (ctx.session.awaitingCaptionTemplate) {
      const handled = await captionSettingsHandler.applyEditInput(ctx, ctx.message.text);
      if (handled) return;
    }
    if (ctx.session.awaitingInput) {
      const handled = await coinPanelHandler.applyInput(ctx, ctx.message.text);
      if (handled) return;
    }
    if (ctx.session.awaitingBulkInput) {
      const handled = await bulkActionsHandler.applyBulkInput(ctx, ctx.message.text);
      if (handled) return;
    }
    return next();
  });

  // --- Inline callback query routing ---
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      await routeCallback(ctx, data);
      await ctx.answerCbQuery().catch(() => {});
    } catch (err) {
      logger.error('Callback routing failed', { data, message: err.message });
      await ctx.answerCbQuery('⚠️ Something went wrong — try again.').catch(() => {});
    }
  });

  return bot;
}

async function goHome(ctx) {
  navStack.reset(ctx);
  await ctx.editMessageText('🏠 Home — use the menu below.').catch(() => {});
  await ctx.reply('🏠 *Home*', { parse_mode: 'Markdown', ...replyKb.home });
}

async function routeCallback(ctx, data) {
  if (data === 'noop') return;
  const parts = data.split(':');
  const [ns, action, ...rest] = parts;
  const fallbackChannelId = await resolveChannelId(ctx);

  // --- Universal nav ---
  if (ns === 'nav') {
    if (action === 'back') return renderScreen(ctx, navStack.pop(ctx));
    if (action === 'home') return goHome(ctx);
    return undefined;
  }

  // --- Help deep links ---
  if (ns === 'help' && action === 'goto') {
    const target = rest[0];
    if (target === 'prices' || target === 'milestones') return coinListHandler.showCoinList(ctx, { page: 0, mode: 'view' });
    if (target === 'charts') return chartsHandler.showChartMenu(ctx);
    if (target === 'feargreed') return fearGreedHandler.showFearGreed(ctx);
    if (target === 'settings') return settingsHandler.showSettings(ctx);
    return undefined;
  }

  // --- Settings root ---
  if (ns === 'settings') {
    if (action === 'togglecardstyle') return settingsHandler.toggleCardStyle(ctx);
    if (action === 'status') return settingsHandler.showStatus(ctx);
    if (action === 'watchlist') return coinListHandler.showCoinList(ctx, { page: 0, mode: 'view', filter: 'watchlist', channelId: fallbackChannelId });
    return undefined;
  }

  // --- Timezone ---
  if (ns === 'tz') {
    if (action === 'show') return timezoneHandler.showTimezone(ctx);
    if (action === 'set') return timezoneHandler.setTimezone(ctx, rest[0]);
    if (action === 'custom') return timezoneHandler.promptCustom(ctx);
    if (action === 'toggleformat') return timezoneHandler.toggleFormat(ctx);
    return undefined;
  }

  // --- Channel alert-delivery settings (digest mode / quiet hours) ---
  if (ns === 'chsettings') {
    if (action === 'show') return channelSettingsHandler.showChannelSettings(ctx, parseInt(rest[0], 10));
    if (action === 'togglemode') return channelSettingsHandler.toggleDigestMode(ctx, parseInt(rest[0], 10));
    if (action === 'interval') {
      const [cid, minutes] = rest;
      return channelSettingsHandler.setInterval(ctx, parseInt(cid, 10), parseInt(minutes, 10));
    }
    if (action === 'quiet') {
      const [cid, spec] = rest;
      return channelSettingsHandler.setQuietHours(ctx, parseInt(cid, 10), spec);
    }
    return undefined;
  }

  // --- Manage channels: add-to-channel deep link + list of registered channels ---
  if (ns === 'managechannels') {
    if (action === 'show') return manageChannelsHandler.showManageChannels(ctx);
    return undefined;
  }

  // --- Caption templates (menu equivalent of PricePing's /setcaption etc) ---
  if (ns === 'captionsettings') {
    if (action === 'show') return captionSettingsHandler.showCaptionSettings(ctx);
    if (action === 'opentype') return captionSettingsHandler.showTypeDetail(ctx, rest[0]);
    if (action === 'edit') return captionSettingsHandler.promptEdit(ctx, rest[0]);
    if (action === 'preview') return captionSettingsHandler.previewType(ctx, rest[0]);
    if (action === 'reset') return captionSettingsHandler.resetType(ctx, rest[0]);
    if (action === 'variables') return captionSettingsHandler.showVariables(ctx);
    return undefined;
  }

  // --- Coin list: pagination lands here since `page` is embedded as a
  // literal token by keyboards/pagination.js (prefix:page:N) ---
  if (ns === 'coinlist') {
    if (action === 'toggle') {
      const [symbol, page, filter, channelId] = rest;
      return coinListHandler.toggleSelection(ctx, symbol, { page: parseInt(page, 10) || 0, filter, channelId: parseInt(channelId, 10) || 0 });
    }
    if (action === 'selectall') {
      const [page, filter, channelId] = rest;
      return coinListHandler.selectAll(ctx, { page: parseInt(page, 10) || 0, filter, channelId: parseInt(channelId, 10) || 0 });
    }
    if (action === 'selectnone') {
      const [page, filter, channelId] = rest;
      return coinListHandler.selectNone(ctx, { page: parseInt(page, 10) || 0, filter, channelId: parseInt(channelId, 10) || 0 });
    }
    if (action === 'switchmode') {
      const [newMode, page, filter, channelId] = rest;
      return coinListHandler.showCoinList(ctx, { page: parseInt(page, 10) || 0, mode: newMode, filter, channelId: parseInt(channelId, 10) || 0 });
    }
    // Pagination form: coinlist:<mode>:<filter>:<channelId>:page:<N>
    // `action` here is actually the mode (view/select); rest = [filter, channelId, 'page', N]
    if (rest[0] === 'all' || rest[0] === 'watchlist') {
      const [filter, channelId, pageLiteral, pageNum] = rest;
      if (pageLiteral === 'page') {
        return coinListHandler.showCoinList(ctx, { page: parseInt(pageNum, 10) || 0, mode: action, filter, channelId: parseInt(channelId, 10) || 0 });
      }
    }
    return undefined;
  }

  // --- Per-coin panel ---
  if (ns === 'coinpanel') {
    const symbol = rest[0];
    const channelId = parseInt(rest[1], 10) || fallbackChannelId;
    if (action === 'open') return coinPanelHandler.showCoinPanel(ctx, symbol, channelId);
    if (action === 'mute') return coinPanelHandler.toggleMute(ctx, symbol, channelId);
    if (action === 'watchlist') return coinPanelHandler.toggleWatchlist(ctx, symbol, channelId);
    if (action === 'card') return coinPanelHandler.sendPreviewCard(ctx, symbol, channelId);
    if (action === 'threshold') return coinPanelHandler.promptForInput(ctx, 'threshold', symbol, channelId);
    if (action === 'milestone') return coinPanelHandler.promptForInput(ctx, 'milestone', symbol, channelId);
    if (action === 'cooldown') return coinPanelHandler.promptForInput(ctx, 'cooldown', symbol, channelId);
    return undefined;
  }

  // --- Bulk actions ---
  if (ns === 'bulk') {
    if (action === 'menu') return bulkActionsHandler.showBulkMenu(ctx);
    if (action === 'action') {
      const bulkAction = rest[0];
      if (bulkAction === 'threshold' || bulkAction === 'milestone') return bulkActionsHandler.promptBulkValueInput(ctx, bulkAction, fallbackChannelId);
      return bulkActionsHandler.applySimpleAction(ctx, bulkAction, fallbackChannelId);
    }
    return undefined;
  }

  // --- Charts ---
  if (ns === 'chart') {
    if (action === 'pickcoin') return chartsHandler.showChartOptions(ctx, rest[0]);
    if (action === 'open') return chartsHandler.showChartOptions(ctx, rest[0]); // entry from coin panel's "View Chart"
    if (action === 'style') {
      const [symbol, style] = rest;
      return style === 'candle' ? chartsHandler.showCandlePeriods(ctx, symbol) : chartsHandler.showChartOptions(ctx, symbol);
    }
    if (action === 'render') {
      const [symbol, period, style] = rest;
      return chartsHandler.renderAndSend(ctx, symbol, period, style);
    }
    return undefined;
  }

  // --- Chart-menu coin list pagination: chartlist:page:N ---
  if (ns === 'chartlist' && action === 'page') {
    const page = parseInt(rest[0], 10) || 0;
    return chartsHandler.showChartMenu(ctx, { page });
  }

  // --- Manual "Post to Channel" flow ---
  if (ns === 'manualpost') {
    if (action === 'start') return manualPostHandler.showChannelPicker(ctx);
    if (action === 'pickchannel') return manualPostHandler.showCoinPicker(ctx, parseInt(rest[0], 10));
    if (action === 'coinselected') return manualPostHandler.showChannelPickerForCoin(ctx, rest[0]);
    if (action === 'pickcoin') {
      const [channelId, symbol] = rest;
      return manualPostHandler.showConfirm(ctx, parseInt(channelId, 10), symbol);
    }
    if (action === 'confirm') {
      const [channelId, symbol] = rest;
      return manualPostHandler.doPost(ctx, parseInt(channelId, 10), symbol);
    }
    return undefined;
  }
  if (data.startsWith('manualpost:coinpage:')) {
    const bits = data.split(':'); // manualpost:coinpage:<channelId>:page:<N>
    const channelId = parseInt(bits[2], 10);
    const page = parseInt(bits[4], 10) || 0;
    return manualPostHandler.showCoinPicker(ctx, channelId, page);
  }

  return undefined;
}

// Used by nav:back to re-render whatever screen is now on top of the stack.
async function renderScreen(ctx, { screen, params }) {
  switch (screen) {
    case 'home':
      return goHome(ctx);
    case 'settings':
      return settingsHandler.showSettings(ctx);
    case 'status':
      return settingsHandler.showStatus(ctx);
    case 'timezone':
      return timezoneHandler.showTimezone(ctx);
    case 'channelSettings':
      return channelSettingsHandler.showChannelSettings(ctx, params.channelId);
    case 'manageChannels':
      return manageChannelsHandler.showManageChannels(ctx);
    case 'captionSettings':
      return captionSettingsHandler.showCaptionSettings(ctx);
    case 'captionTypeDetail':
      return captionSettingsHandler.showTypeDetail(ctx, params.alertType);
    case 'captionVariables':
      return captionSettingsHandler.showVariables(ctx);
    case 'postChannelPicker':
      return manualPostHandler.showChannelPicker(ctx);
    case 'postChannelPickerForCoin':
      return manualPostHandler.showChannelPickerForCoin(ctx, params.symbol);
    case 'postCoinPicker':
      return manualPostHandler.showCoinPicker(ctx, params.channelId, params.page);
    case 'postConfirm':
      return manualPostHandler.showConfirm(ctx, params.channelId, params.symbol);
    case 'coinList':
      return coinListHandler.showCoinList(ctx, params);
    case 'coinPanel':
      return coinPanelHandler.showCoinPanel(ctx, params.symbol, params.channelId);
    case 'chartMenu':
      return chartsHandler.showChartMenu(ctx, params);
    case 'chartOptions':
      return chartsHandler.showChartOptions(ctx, params.symbol);
    case 'fearGreed':
      return fearGreedHandler.showFearGreed(ctx);
    default:
      return goHome(ctx);
  }
}

module.exports = { createBot };
