const logger = require('../utils/logger');
const rulesDb = require('../db/rules');
const channelsDb = require('../db/channels');
const alertsLogDb = require('../db/alertsLog');
const marketData = require('./marketData');
const chartRenderer = require('./chartRenderer');
const templateEngine = require('./templateEngine');
const telegramSender = require('./telegramSender');

// Called right after an alert successfully sends (see poller.js). Looks
// for any enabled rule whose trigger matches this alert and fires its
// action. Each action is independent and best-effort — one rule failing
// (bad channel name, Binance hiccup) never blocks the others or the alert
// that triggered them, since the primary send already happened.
//
// alert: { coin, price, changeUsd, changePct, direction, alertType,
//          milestoneLevel, threshold }
async function evaluate(telegram, alert) {
  let rules;
  try {
    rules = await rulesDb.getEnabled();
  } catch (err) {
    logger.warn('Could not load rules', { message: err.message });
    return;
  }

  const matching = rules.filter(
    (r) =>
      (r.triggerType === 'any_alert' || r.triggerType === alert.alertType) &&
      (!r.triggerSymbol || r.triggerSymbol === alert.coin.symbol)
  );

  for (const rule of matching) {
    try {
      await runAction(telegram, rule, alert);
    } catch (err) {
      logger.warn(`Rule ${rule.id} action failed`, { message: err.message });
    }
  }
}

async function runAction(telegram, rule, alert) {
  const params = rule.actionParams || {};

  if (rule.actionType === 'mirror') {
    const channel = await channelsDb.get(params.channel);
    if (!channel) {
      logger.warn(`Rule ${rule.id}: mirror target channel "${params.channel}" not found`);
      return;
    }
    const sent = await telegramSender.sendAlert(telegram, alert, channel);
    if (sent) {
      await alertsLogDb.record(alert.coin.symbol, alert.price, alert.changeUsd || 0, alert.direction, alert.alertType, channel.name);
    }
    return;
  }

  if (rule.actionType === 'post_chart') {
    const channel = await channelsDb.get(params.channel);
    if (!channel) {
      logger.warn(`Rule ${rule.id}: post_chart target channel "${params.channel}" not found`);
      return;
    }
    const periodKey = params.period || '24h';
    const preset = chartRenderer.PERIOD_PRESETS[periodKey] || chartRenderer.PERIOD_PRESETS['24h'];
    const candles = await marketData.fetchKlinesForSymbol(alert.coin.symbol, preset.interval, preset.limit);
    if (candles.length < 2) return;
    const buffer = await chartRenderer.renderChart({ coin: alert.coin, candles, periodKey });
    await telegramSender.sendChart(telegram, { coin: alert.coin, buffer, periodLabel: preset.label }, channel);
    return;
  }

  if (rule.actionType === 'broadcast') {
    const channel = await channelsDb.get(params.channel);
    if (!channel || !params.message) return;
    const vars = templateEngine.buildVariables({ ...alert, channel });
    const text = templateEngine.render(params.message, vars);
    await telegramSender.sendBroadcast(telegram, text, channel);
    return;
  }

  logger.warn(`Rule ${rule.id}: unknown action_type "${rule.actionType}"`);
}

module.exports = { evaluate };
