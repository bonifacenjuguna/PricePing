const menu = require('../views/menu');
const commands = require('../handlers/commands');
const settingsDb = require('../db/settings');
const logger = require('../utils/logger');
const recentCoins = require('../services/recentCoins');

// callback_data is always colon-separated: prefix:action:...args
async function onCallback(ctx) {
  const data = ctx.callbackQuery && ctx.callbackQuery.data;
  if (!data) return undefined;

  const parts = data.split(':');
  const [ns, a1, a2, a3, a4] = parts;

  try {
    // ---- nav: screen navigation ----
    if (ns === 'nav') {
      await ctx.answerCbQuery();
      switch (a1) {
        case 'home':
          return commands.home(ctx);
        case 'hub':
          return commands.hubCmd(ctx);
        case 'prices':
          return commands.pricesCmd(ctx);
        case 'thresholds':
          return commands.thresholdsCmd(ctx);
        case 'stats':
          return commands.statsCmd(ctx);
        case 'settings':
          return commands.settingsCmd(ctx);
        case 'test': {
          const screen = menu.testPicker(recentCoins.getRecent());
          return ctx.reply(screen.text, { reply_markup: { inline_keyboard: screen.keyboard } });
        }
        case 'postmenu':
          return commands.postMenuScreen(ctx);
        case 'chartmenu':
          return commands.chartMenuScreen(ctx);
        case 'mutemenu':
          return commands.muteMenuScreen(ctx);
        case 'pausemenu':
          return commands.pauseMenuScreen(ctx);
        case 'automation':
          return commands.automationHubScreen(ctx);
        case 'channels':
          return commands.channelsScreen(ctx);
        case 'captiontypes':
          return commands.captionTypesScreen(ctx);
        case 'variables':
          return commands.variablesScreen(ctx);
        case 'schedules':
          return commands.schedulesScreen(ctx);
        case 'rules':
          return commands.rulesScreen(ctx);
        case 'coinsettings':
          return commands.coinSettingsMenuScreen(ctx);
        case 'reset':
          return commands.resetMenuScreen(ctx);
        case 'broadcastmenu':
          return commands.broadcastMenuScreen(ctx);
        default:
          return undefined;
      }
    }

    // ---- action: one-off toggles / undo / legacy simple test ----
    if (ns === 'action') {
      if (a1 === 'pause') {
        await settingsDb.setPaused(true);
        await ctx.answerCbQuery('Paused');
        return commands.home(ctx);
      }
      if (a1 === 'resume') {
        return commands.resume(ctx);
      }
      if (a1 === 'undothreshold') {
        await ctx.answerCbQuery();
        return commands.undoThreshold(ctx, a2);
      }
      if (a1 === 'test') {
        await ctx.answerCbQuery();
        return commands.sendTestAlert(ctx, a2);
      }
      return undefined;
    }

    // ---- threshold:inc|dec:SYMBOL (edit screen folded into coin:settings) ----
    if (ns === 'threshold') {
      if (a1 === 'edit') {
        await ctx.answerCbQuery();
        return commands.coinSettingsScreen(ctx, a2);
      }
      if (a1 === 'inc' || a1 === 'dec') {
        return commands.thresholdAdjust(ctx, a2, a1);
      }
      return undefined;
    }

    // ---- coin:settings:SYMBOL ----
    if (ns === 'coin') {
      if (a1 === 'settings') {
        await ctx.answerCbQuery();
        return commands.coinSettingsScreen(ctx, a2);
      }
      return undefined;
    }

    // ---- milestone:inc|dec|toggle:SYMBOL ----
    if (ns === 'milestone') {
      if (a1 === 'inc' || a1 === 'dec') {
        return commands.milestoneAdjust(ctx, a2, a1);
      }
      if (a1 === 'toggle') {
        return commands.milestoneToggle(ctx, a2);
      }
      return undefined;
    }

    // ---- cooldown:inc|dec|reset:SYMBOL ----
    if (ns === 'cooldown') {
      if (a1 === 'inc' || a1 === 'dec') {
        return commands.cooldownAdjust(ctx, a2, a1);
      }
      if (a1 === 'reset') {
        return commands.cooldownResetBtn(ctx, a2);
      }
      return undefined;
    }

    // ---- mute:coin|apply|clear ----
    if (ns === 'mute') {
      if (a1 === 'coin') {
        await ctx.answerCbQuery();
        return commands.muteDurationScreen(ctx, a2);
      }
      if (a1 === 'apply') {
        return commands.muteApply(ctx, a2, a3);
      }
      if (a1 === 'clear') {
        return commands.muteClear(ctx, a2);
      }
      return undefined;
    }

    // ---- pause:apply:CODE ----
    if (ns === 'pause') {
      if (a1 === 'apply') {
        return commands.pauseApply(ctx, a2);
      }
      return undefined;
    }

    // ---- post:coin:SYMBOL | post:send:SYMBOL:CHANNEL ----
    if (ns === 'post') {
      if (a1 === 'coin') {
        await ctx.answerCbQuery();
        recentCoins.noteCoin(a2);
        return commands.postChannelScreen(ctx, a2);
      }
      if (a1 === 'send') {
        return commands.postExecute(ctx, a2, a3);
      }
      return undefined;
    }

    // ---- chart:coin | chart:period | chart:send | chart:preview ----
    if (ns === 'chart') {
      if (a1 === 'coin') {
        await ctx.answerCbQuery();
        recentCoins.noteCoin(a2);
        return commands.chartPeriodScreen(ctx, a2);
      }
      if (a1 === 'period') {
        await ctx.answerCbQuery();
        return commands.chartChannelScreen(ctx, a2, a3);
      }
      if (a1 === 'send') {
        return commands.chartSendExecute(ctx, a2, a3, a4);
      }
      if (a1 === 'preview') {
        return commands.chartPreviewExecute(ctx, a2, a3);
      }
      return undefined;
    }

    // ---- channel:add|del|setdefault ----
    if (ns === 'channel') {
      if (a1 === 'add') {
        return commands.channelAddStart(ctx);
      }
      if (a1 === 'del') {
        return commands.channelDel(ctx, a2);
      }
      if (a1 === 'setdefault') {
        return commands.channelSetDefault(ctx, a2);
      }
      return undefined;
    }

    // ---- broadcast:pick:CHANNEL ----
    if (ns === 'broadcast') {
      if (a1 === 'pick') {
        return commands.broadcastPick(ctx, a2);
      }
      return undefined;
    }

    // ---- caption:type|edit|preview|reset:TYPE ----
    if (ns === 'caption') {
      if (a1 === 'type') {
        await ctx.answerCbQuery();
        return commands.captionDetailScreen(ctx, a2);
      }
      if (a1 === 'edit') {
        return commands.captionEditStart(ctx, a2);
      }
      if (a1 === 'preview') {
        return commands.captionPreview(ctx, a2);
      }
      if (a1 === 'reset') {
        return commands.captionReset(ctx, a2);
      }
      return undefined;
    }

    // ---- schedule:add|del|edit ----
    if (ns === 'schedule') {
      if (a1 === 'add') {
        return commands.scheduleAddStart(ctx);
      }
      if (a1 === 'del') {
        return commands.scheduleDel(ctx, a2);
      }
      if (a1 === 'edit') {
        return commands.scheduleEditStart(ctx, a2);
      }
      return undefined;
    }

    // ---- rule:add|del|edit ----
    if (ns === 'rule') {
      if (a1 === 'add') {
        return commands.ruleAddStart(ctx);
      }
      if (a1 === 'del') {
        return commands.ruleDel(ctx, a2);
      }
      if (a1 === 'edit') {
        return commands.ruleEditStart(ctx, a2);
      }
      return undefined;
    }

    // ---- addcoin:confirm|cancel ----
    if (ns === 'addcoin') {
      if (a1 === 'confirm') {
        return commands.addCoinConfirmExecute(ctx);
      }
      if (a1 === 'cancel') {
        return commands.addCoinCancel(ctx);
      }
      return undefined;
    }

    // ---- reset:confirm|execute:TYPE ----
    if (ns === 'reset') {
      if (a1 === 'confirm') {
        await ctx.answerCbQuery();
        return commands.resetConfirmScreen(ctx, a2);
      }
      if (a1 === 'execute') {
        return commands.resetExecute(ctx, a2);
      }
      return undefined;
    }

    // ---- test:coin|type|value|send|full ----
    if (ns === 'test') {
      if (a1 === 'coin') {
        await ctx.answerCbQuery();
        return commands.testTypeScreen(ctx, a2);
      }
      if (a1 === 'type') {
        await ctx.answerCbQuery();
        return commands.testTypeChosen(ctx, a2, a3);
      }
      if (a1 === 'value') {
        await ctx.answerCbQuery();
        return commands.testDestinationScreen(ctx, a2, a3, a4);
      }
      if (a1 === 'send') {
        const dest = parts[5];
        return commands.testExecute(ctx, a2, a3, a4, dest);
      }
      if (a1 === 'full') {
        return commands.testFull(ctx);
      }
      return undefined;
    }

    await ctx.answerCbQuery();
    return undefined;
  } catch (err) {
    logger.error('Callback handling failed', { data, message: err.message });
    try {
      await ctx.answerCbQuery('Something went wrong — try again.');
    } catch {
      /* non-fatal */
    }
    return undefined;
  }
}

module.exports = { onCallback };
