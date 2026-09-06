const renderScreen = require('../utils/renderScreen');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const config = require('../config');
const modes = require('../services/modes');
const settingsDb = require('../db/settings');
const pendingInput = require('../services/pendingInput');
const automationScheduler = require('../services/automationScheduler');

async function showHub(ctx) {
  await renderScreen(ctx, '🤖 <b>Automation</b>\n\nScheduled posts and how Bot Mode scales them.', {
    parse_mode: 'HTML',
    ...inline.automationHub,
  });
}

async function showScheduledMenu(ctx) {
  await renderScreen(ctx, '📊 <b>Scheduled Posts</b>\n\nPick a type to view its cadence.', {
    parse_mode: 'HTML',
    ...inline.scheduledPostsMenu,
  });
}

const BASE_INTERVALS = {
  chart: config.chartBaseIntervalMs,
  movers: config.moversBaseIntervalMs,
  feargreed: config.feargreedBaseIntervalMs,
};

function hoursLabel(ms) {
  const hours = ms / (60 * 60 * 1000);
  return hours >= 1 ? `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h` : `${Math.round(ms / 60000)}m`;
}

async function showScheduledDetail(ctx, kind) {
  const mode = await modes.getCurrentMode();
  const modeKey = await modes.getCurrentModeKey();
  const base = BASE_INTERVALS[kind];
  const effective = base * mode.multiplier;
  const skipped = kind === 'movers' && modes.isAntiSpam(modeKey);

  const labels = { chart: '📈 Charts', movers: '📊 Movers', feargreed: '😨 Fear & Greed' };
  let text = `<b>${labels[kind]}</b>\n\nBase interval: ${hoursLabel(base)}\nCurrent mode (${mode.label}): every ${hoursLabel(effective)}`;
  if (skipped) text += '\n\n⛔ Skipped entirely in Anti-Spam mode.';

  await renderScreen(ctx, text, { parse_mode: 'HTML', ...inline.scheduledPostsMenu });
}

async function showDigestsMenu(ctx) {
  const hour = (await settingsDb.get('digest_hour')) || config.digestHourUtc;
  await renderScreen(ctx, 
    `📅 <b>Digests</b>\n\nDaily digest fires at ${hour}:00 (your configured timezone).\nWeekly digest fires Mondays at the same time.`,
    { parse_mode: 'HTML', ...inline.digestsMenu }
  );
}

async function showDigestDetail(ctx, kind) {
  await renderScreen(ctx, `${kind === 'daily' ? '📅 Daily' : '📅 Weekly'} digest is controlled by the shared digest hour setting.`, {
    parse_mode: 'HTML',
    ...inline.digestsMenu,
  });
}

async function previewDigest(ctx) {
  await ctx.answerCbQuery('Generating preview…');
  await automationScheduler.sendDigest('daily');
  await ctx.reply('Preview sent to bound channels (respecting the digest post-type toggle).');
}

async function showModePicker(ctx) {
  const kb = await inline.modePicker();
  await renderScreen(ctx, '⚡ <b>Mode</b>\n\nPick one — it applies instantly.', { parse_mode: 'HTML', ...kb });
}

async function setMode(ctx, key) {
  const mode = await modes.setMode(key);
  await ctx.answerCbQuery(`Switched to ${mode.label}`);
  await showModePicker(ctx);
}

async function showModeDetails(ctx) {
  const lines = modes.MODE_ORDER.map((key) => {
    const m = modes.MODE_DEFS[key];
    return `${m.label} — ${m.description}`;
  });
  await renderScreen(ctx, `⚡ <b>Mode Details</b>\n\n${lines.join('\n')}`, {
    parse_mode: 'HTML',
    ...inline.modeDetailsBack,
  });
}

module.exports = {
  showHub,
  showScheduledMenu,
  showScheduledDetail,
  showDigestsMenu,
  showDigestDetail,
  previewDigest,
  showModePicker,
  setMode,
  showModeDetails,
};
