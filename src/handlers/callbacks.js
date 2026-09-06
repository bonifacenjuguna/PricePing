const renderScreen = require('../utils/renderScreen');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const watching = require('./watching');
const broadcasting = require('./broadcasting');
const automation = require('./automation');
const botSettings = require('./botSettings');
const manualPost = require('./manualPost');

async function showMainMenu(ctx) {
  await renderScreen(ctx, '◆ <b>PricePing</b> — main menu', { parse_mode: 'HTML', ...inline.mainMenu });
}

function register(bot) {
  // Registered first so it wraps every bot.action() below via next() — a
  // safety net that acks the callback (clears Telegram's loading spinner)
  // even for handlers that don't explicitly call answerCbQuery themselves.
  bot.on('callback_query', async (ctx, next) => {
    await next();
    try {
      await ctx.answerCbQuery();
    } catch {
      /* already answered by the specific handler — fine */
    }
  });

  bot.action('menu:root', showMainMenu);
  bot.action('menu:watching', watching.showHub);
  bot.action('menu:broadcasting', broadcasting.showHub);
  bot.action('menu:automation', automation.showHub);
  bot.action('menu:bot', botSettings.showHub);

  // --- Watching ---
  bot.action(/^watching:coins:(\d+)$/, (ctx) => watching.showCoinList(ctx, Number(ctx.match[1])));
  bot.action('watching:thresholds', watching.showThresholdsMenu);
  bot.action('watching:sync', watching.forceSync);
  bot.action(/^coin:view:(.+)$/, (ctx) => watching.showCoinDetail(ctx, ctx.match[1]));
  bot.action(/^coin:threshold:(.+)$/, (ctx) => watching.promptThresholdOverride(ctx, ctx.match[1]));
  bot.action(/^coin:mute:(.+)$/, (ctx) => watching.toggleMute(ctx, ctx.match[1]));
  bot.action(/^coin:relogo:(.+)$/, (ctx) => watching.relogo(ctx, ctx.match[1]));
  bot.action(/^threshold:edit:(.+)$/, (ctx) => watching.promptTierEdit(ctx, ctx.match[1]));
  bot.action('threshold:overrides', watching.showOverrides);

  // --- Broadcasting ---
  bot.action('broadcasting:channels', broadcasting.showChannelList);
  bot.action(/^channel:view:(.+)$/, (ctx) => broadcasting.showChannelDetail(ctx, ctx.match[1]));
  bot.action(/^channel:toggle:(.+):(.+)$/, (ctx) => broadcasting.toggleChannelPostType(ctx, ctx.match[1], ctx.match[2]));
  bot.action('channel:add', broadcasting.promptAddChannel);
  bot.action(/^channel:remove:confirm:(.+)$/, (ctx) => broadcasting.confirmRemoveChannel(ctx, ctx.match[1]));
  bot.action(/^channel:remove:do:(.+)$/, (ctx) => broadcasting.removeChannel(ctx, ctx.match[1]));
  bot.action('broadcasting:format', broadcasting.showFormatMenu);
  bot.action(/^format:edit:(.+)$/, (ctx) => broadcasting.showFormatDetail(ctx, ctx.match[1]));
  bot.action(/^format:setnew:(.+)$/, (ctx) => broadcasting.promptEditFormat(ctx, ctx.match[1]));
  bot.action(/^format:reset:(.+)$/, (ctx) => broadcasting.resetFormat(ctx, ctx.match[1]));
  bot.action(/^format:preview:(.+)$/, (ctx) => broadcasting.previewFormat(ctx, ctx.match[1]));

  // --- Automation ---
  bot.action('automation:scheduled', automation.showScheduledMenu);
  bot.action(/^scheduled:view:(.+)$/, (ctx) => automation.showScheduledDetail(ctx, ctx.match[1]));
  bot.action('automation:digests', automation.showDigestsMenu);
  bot.action(/^digest:view:(.+)$/, (ctx) => automation.showDigestDetail(ctx, ctx.match[1]));
  bot.action('digest:preview', automation.previewDigest);
  bot.action('automation:modedetails', automation.showModeDetails);
  bot.action('mode:picker', automation.showModePicker);
  bot.action(/^mode:set:(.+)$/, (ctx) => automation.setMode(ctx, ctx.match[1]));

  // --- Bot ---
  bot.action('bot:timezone', botSettings.showTimezone);
  bot.action('bot:timezone:set', botSettings.promptSetTimezone);
  bot.action('bot:status', botSettings.showStatus);

  // --- Manual Post ---
  bot.action('post:new', (ctx) => manualPost.showCoinList(ctx, 1));
  bot.action(/^post:coinpage:(\d+)$/, (ctx) => manualPost.showCoinList(ctx, Number(ctx.match[1])));
  bot.action('post:search', manualPost.promptSearch);
  bot.action(/^post:coin:(.+)$/, (ctx) => manualPost.showTypeChoice(ctx, ctx.match[1]));
  bot.action(/^post:type:card:(.+)$/, (ctx) => manualPost.showChannelChoiceForCard(ctx, ctx.match[1]));
  bot.action(/^post:type:chart:(.+)$/, (ctx) => manualPost.showChartStyle(ctx, ctx.match[1]));
  bot.action(/^post:chartstyle:(.+):(.+)$/, (ctx) => manualPost.showChartPeriod(ctx, ctx.match[1], ctx.match[2]));
  bot.action(/^post:period:(.+):(.+):(.+)$/, (ctx) => manualPost.showChannelChoiceForChart(ctx, ctx.match[1], ctx.match[2], ctx.match[3]));
  bot.action(/^post:send:(.+):(.+)$/, (ctx) => manualPost.executeSend(ctx, ctx.match[1], ctx.match[2]));
}

module.exports = { register, showMainMenu };
