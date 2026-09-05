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
  const [ns, a1, a2, a3, a4, a5] = parts;

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
        case 'captionpacks':
          return commands.captionPackMenuScreen(ctx);
        case 'variables':
          return commands.variablesScreen(ctx);
        case 'schedules':
          return commands.schedulesScreen(ctx);
        case 'rules':
          return commands.rulesScreen(ctx);
        case 'movers':
          return commands.moversScreen(ctx);
        case 'markets':
          return commands.marketsHubScreen(ctx);
        case 'publish':
          return commands.publishHubScreen(ctx);
        case 'safetyadmin':
          return commands.safetyAdminHubScreen(ctx);
        case 'heldback':
          return commands.heldBackAlertsScreen(ctx);
        case 'feargreed':
          return commands.fearGreedScreen(ctx);
        case 'tags':
          return commands.tagsScreen(ctx);
        case 'coinsettings':
          return commands.coinSettingsMenuScreen(ctx);
        case 'coinlist':
          return commands.coinListScreen(ctx);
        case 'milestones':
          return commands.milestonesScreen(ctx);
        case 'history':
          return commands.historyMenuScreen(ctx);
        case 'varsmanage':
          return commands.varsManageScreen(ctx);
        case 'backup':
          return commands.backupMenuScreen(ctx);
        case 'auditlog':
          return commands.auditLogScreen(ctx);
        case 'usage':
          return commands.usageScreen(ctx);
        case 'pins':
          return commands.pinManageScreen(ctx);
        case 'whoami':
          return commands.whoami(ctx);
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
      if (a1 === 'killswitch') {
        return commands.killSwitchToggle(ctx);
      }
      if (a1 === 'cardstyletoggle') {
        return commands.cardStyleToggle(ctx);
      }
      return undefined;
    }

    // ---- undo:ID (generic undo — see services/undoStack.js) ----
    if (ns === 'undo') {
      return commands.undoExecute(ctx, a1);
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
      if (a1 === 'setexact') {
        return commands.thresholdSetExactStart(ctx, a2);
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
      if (a1 === 'setexact') {
        return commands.milestoneSetExactStart(ctx, a2);
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

    // ---- chart:coin | chart:style | chart:period | chart:send | chart:preview ----
    if (ns === 'chart') {
      if (a1 === 'coin') {
        await ctx.answerCbQuery();
        recentCoins.noteCoin(a2);
        return commands.chartStyleScreen(ctx, a2);
      }
      if (a1 === 'style') {
        await ctx.answerCbQuery();
        return commands.chartPeriodScreen(ctx, a2, a3);
      }
      if (a1 === 'period') {
        await ctx.answerCbQuery();
        return commands.chartChannelScreen(ctx, a2, a3, a4);
      }
      if (a1 === 'send') {
        return commands.chartSendExecute(ctx, a2, a3, a4, a5);
      }
      if (a1 === 'preview') {
        return commands.chartPreviewExecute(ctx, a2, a3, a4);
      }
      return undefined;
    }

    // ---- channel:add|del|setdefault|typedefault|settypedefault|cleartypedefault ----
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
      if (a1 === 'typedefault' && !a2) {
        return commands.channelTypeDefaultScreen(ctx);
      }
      if (a1 === 'typedefault' && a2) {
        return commands.channelTypeDefaultChannelScreen(ctx, a2);
      }
      if (a1 === 'settypedefault') {
        return commands.channelSetTypeDefaultExecute(ctx, a2, a3);
      }
      if (a1 === 'cleartypedefault') {
        return commands.channelClearTypeDefault(ctx, a2);
      }
      return undefined;
    }

    // ---- history:coin:SYMBOL[:OFFSET] | history:filter:SYMBOL:CHANNEL:OFFSET ----
    if (ns === 'history') {
      await ctx.answerCbQuery();
      if (a1 === 'coin') {
        return commands.historyCoinScreen(ctx, a2, null, a3 ? Number(a3) : 0);
      }
      if (a1 === 'filter') {
        return commands.historyCoinScreen(ctx, a2, a3 === '-' ? null : a3, a4 ? Number(a4) : 0);
      }
      return undefined;
    }

    // ---- var:add|del ----
    if (ns === 'var') {
      if (a1 === 'add') {
        return commands.varAddStart(ctx);
      }
      if (a1 === 'del') {
        return commands.varDelBtn(ctx, a2);
      }
      return undefined;
    }

    // ---- pin:toggle:KEY ----
    if (ns === 'pin') {
      if (a1 === 'toggle') {
        return commands.pinToggle(ctx, a2);
      }
      return undefined;
    }

    // ---- backup:export|import ----
    if (ns === 'backup') {
      if (a1 === 'export') {
        return commands.exportConfigButton(ctx);
      }
      if (a1 === 'import') {
        return commands.importConfigButton(ctx);
      }
      return undefined;
    }

    // ---- digest:now ----
    if (ns === 'digest') {
      if (a1 === 'now') {
        return commands.digestNowButton(ctx);
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

    // ---- captionpack:apply:NAME ----
    if (ns === 'captionpack') {
      if (a1 === 'apply') {
        return commands.captionPackApply(ctx, a2);
      }
      return undefined;
    }

    // ---- caption:type|edit|preview|reset|overrides|coinpick|coinedit|coinpreview|coinreset ----
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
      if (a1 === 'overrides') {
        return commands.captionOverridesScreen(ctx, a2);
      }
      if (a1 === 'coinpick') {
        await ctx.answerCbQuery();
        return commands.captionCoinDetailScreen(ctx, a2, a3);
      }
      if (a1 === 'coinedit') {
        return commands.captionCoinEditStart(ctx, a2, a3);
      }
      if (a1 === 'coinpreview') {
        return commands.captionCoinPreviewBtn(ctx, a2, a3);
      }
      if (a1 === 'coinreset') {
        return commands.captionCoinResetBtn(ctx, a2, a3);
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

    // ---- heldback: clear the held-back alerts log ----
    if (ns === 'heldback') {
      if (a1 === 'clear') return commands.heldBackAlertsClear(ctx);
      return undefined;
    }

    // ---- tz: timezone picker ----
    if (ns === 'tz') {
      if (a1 === 'start') return commands.timezoneStart(ctx);
      if (a1 === 'set') return commands.timezonePick(ctx, data.split(':').slice(2).join(':'));
      if (a1 === 'custom') return commands.timezoneCustomStart(ctx);
      return undefined;
    }

    // ---- markets: hub — categories, top20, gainers/losers, watchlist ----
    if (ns === 'markets') {
      if (a1 === 'cat') return commands.marketsCategoryScreen(ctx, a2);
      if (a1 === 'top20') return commands.marketsTop20Screen(ctx);
      if (a1 === 'gainers') return commands.marketsGainersScreen(ctx);
      if (a1 === 'losers') return commands.marketsLosersScreen(ctx);
      if (a1 === 'watchlist') return commands.marketsWatchlistScreen(ctx);
      if (a1 === 'reclassify') return commands.marketsReclassifyStart(ctx);
      if (a1 === 'watch') return commands.marketsWatchToggle(ctx, a2);
      return undefined;
    }

    // ---- movers:poststart:TAG|all, movers:postto:TAG|all:CHANNEL ----
    if (ns === 'movers') {
      if (a1 === 'poststart') return commands.moversPostStart(ctx, a2);
      if (a1 === 'postto') return commands.moversPostExecute(ctx, a2, a3);
      return undefined;
    }

    // ---- tag:view|addstart|addcoin ----
    if (ns === 'tag') {
      if (a1 === 'view') return commands.tagDetailScreen(ctx, a2);
      if (a1 === 'addstart') return commands.tagAddStart(ctx);
      if (a1 === 'addcoin') return commands.tagAddPickCoin(ctx, a2);
      return undefined;
    }

    // ---- bulk: multi-step wizard for applying a threshold/mute to many
    // coins at once (all coins, or everything under a tag) ----
    if (ns === 'bulk') {
      if (a1 === 'start') return commands.bulkStart(ctx);
      if (a1 === 'act') return commands.bulkPickAction(ctx, a2);
      if (a1 === 'scope') {
        // scope arg is either "all" or "tag:<name>" — a2 only captures the
        // first colon-split segment, so reconstruct from the raw data.
        const scopeArg = data.split(':').slice(2).join(':');
        return commands.bulkPickScope(ctx, scopeArg);
      }
      if (a1 === 'mutedur') return commands.bulkPickMuteDuration(ctx, a2);
      if (a1 === 'cancel') return commands.bulkCancel(ctx);
      return undefined;
    }
    // (see wizardState.js — accumulated choices live there, not in
    // callback_data, so each step here only ever carries one short value)
    if (ns === 'rulewiz') {
      if (a1 === 'trig') return commands.ruleWizardPickTrigger(ctx, a2);
      if (a1 === 'coin') return commands.ruleWizardPickCoin(ctx, a2);
      if (a1 === 'dir') return commands.ruleWizardPickDirection(ctx, a2);
      if (a1 === 'min') return commands.ruleWizardPickMinMove(ctx, a2);
      if (a1 === 'act') return commands.ruleWizardPickAction(ctx, a2);
      if (a1 === 'chan') return commands.ruleWizardPickChannel(ctx, a2);
      if (a1 === 'per') return commands.ruleWizardPickPeriod(ctx, a2);
      if (a1 === 'mcoin') return commands.ruleWizardPickMuteCoin(ctx, a2);
      if (a1 === 'mdur') return commands.ruleWizardPickMuteDuration(ctx, a2);
      if (a1 === 'confirm') return commands.ruleWizardConfirmExecute(ctx);
      if (a1 === 'cancel') return commands.ruleWizardCancel(ctx);
      return undefined;
    }

    // ---- addcoin:start|confirm|cancel ----
    if (ns === 'addcoin') {
      if (a1 === 'start') {
        return commands.addCoinStart(ctx);
      }
      if (a1 === 'confirm') {
        return commands.addCoinConfirmExecute(ctx);
      }
      if (a1 === 'cancel') {
        return commands.addCoinCancel(ctx);
      }
      return undefined;
    }

    // ---- coinselect: multi-select coin picker (tap to check/uncheck) ----
    if (ns === 'coinselect') {
      if (a1 === 'start') return commands.coinSelectScreen(ctx);
      if (a1 === 'toggle') return commands.coinSelectToggle(ctx, a2);
      if (a1 === 'clear') return commands.coinSelectClear(ctx);
      if (a1 === 'done') return commands.coinSelectDone(ctx);
      if (a1 === 'remove') return commands.coinSelectRemove(ctx);
      if (a1 === 'mutestart') return commands.coinSelectMuteStart(ctx);
      if (a1 === 'mutedur') return commands.coinSelectMuteDurationPick(ctx, a2);
      if (a1 === 'thresholdstart') return commands.coinSelectThresholdStart(ctx);
      return undefined;
    }

    // ---- removecoin:pick|confirm|cancel ----
    if (ns === 'removecoin') {
      if (a1 === 'pick') return commands.removeCoinPick(ctx, a2);
      if (a1 === 'confirm') return commands.removeCoinConfirmExecute(ctx);
      if (a1 === 'cancel') return commands.removeCoinCancel(ctx);
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
