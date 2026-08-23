const commands = require('./commands');
const settingsDb = require('../db/settings');
const logger = require('../utils/logger');

async function onCallback(ctx) {
  const data = ctx.callbackQuery && ctx.callbackQuery.data;
  if (!data) return;

  try {
    await ctx.answerCbQuery(); // stop the loading spinner promptly
  } catch {
    /* non-fatal */
  }

  try {
    if (data === 'nav:home') return await commands.home(ctx);
    if (data === 'nav:prices') return await commands.pricesCmd(ctx);
    if (data === 'nav:thresholds') return await commands.thresholdsCmd(ctx);
    if (data === 'nav:stats') return await commands.statsCmd(ctx);
    if (data === 'nav:settings') return await commands.settingsCmd(ctx);
    if (data === 'nav:test') {
      const menu = require('../views/menu');
      const screen = menu.testPicker();
      return await ctx.reply(screen.text, { reply_markup: { inline_keyboard: screen.keyboard } });
    }

    if (data === 'action:pause') {
      await settingsDb.setPaused(true);
      await ctx.reply('Paused \u2014 no alerts will be posted until you resume.');
      return await commands.home(ctx);
    }
    if (data === 'action:resume') {
      await settingsDb.setPaused(false);
      await ctx.reply('Resumed \u2014 alerts will post as usual.');
      return await commands.home(ctx);
    }

    if (data.startsWith('action:test:')) {
      const symbol = data.split(':')[2];
      return await commands.sendTestAlert(ctx, symbol);
    }

    if (data.startsWith('action:undothreshold:')) {
      const symbol = data.split(':')[2];
      return await commands.undoThreshold(ctx, symbol);
    }
  } catch (err) {
    logger.error('Error handling callback query', { data, message: err.message });
    try {
      await ctx.reply('Something went wrong handling that \u2014 try again.');
    } catch {
      /* non-fatal */
    }
  }
  return undefined;
}

module.exports = { onCallback };
