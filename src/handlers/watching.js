const renderScreen = require('../utils/renderScreen');
const inline = require('../keyboards/inline');
const coinsDb = require('../db/coins');
const settingsDb = require('../db/settings');
const pendingInput = require('../services/pendingInput');
const bbtb = require('../keyboards/bbtb');
const binanceSync = require('../services/binanceSync');
const config = require('../config');

const PAGE_SIZE = 8;

async function showHub(ctx) {
  await renderScreen(ctx, '📡 <b>Watching</b>\n\nWhat is being tracked, and how sensitive alerts are.', {
    parse_mode: 'HTML',
    ...inline.watchingHub,
  });
}

async function showCoinList(ctx, page) {
  const all = await coinsDb.getAll();
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const slice = all.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  await renderScreen(ctx, `🪙 <b>Tracked Coins</b> (${all.length} total) — page ${clampedPage}/${totalPages}`, {
    parse_mode: 'HTML',
    ...inline.coinList(slice, clampedPage, totalPages),
  });
}

async function showCoinDetail(ctx, symbol) {
  const coin = await coinsDb.get(symbol);
  if (!coin) return ctx.answerCbQuery('Coin no longer tracked.');
  const text =
    `<b>${coin.name} (${coin.symbol})</b>\n\n` +
    `Tier: ${coin.tier}\n` +
    `Threshold: ${coin.threshold_value}${coin.threshold_type === 'pct' ? '%' : ' USD'}\n` +
    `Last price: ${coin.last_price ? `$${coin.last_price}` : '—'}\n` +
    `Status: ${coin.muted ? '🔕 Muted' : '🔔 Active'}`;
  await renderScreen(ctx, text, { parse_mode: 'HTML', ...inline.coinDetail(coin) });
}

async function promptThresholdOverride(ctx, symbol) {
  await pendingInput.set(`coin:threshold:${symbol}`);
  await ctx.reply(`Send the new threshold for ${symbol} — a plain number (e.g. "3" for 3%, or "150" for $150 if using USD).`, bbtb.cancelOnly);
  await ctx.answerCbQuery();
}

async function toggleMute(ctx, symbol) {
  const coin = await coinsDb.get(symbol);
  if (!coin) return ctx.answerCbQuery('Coin no longer tracked.');
  await coinsDb.setMuted(symbol, !coin.muted);
  await showCoinDetail(ctx, symbol);
  await ctx.answerCbQuery(coin.muted ? 'Unmuted' : 'Muted');
}

async function relogo(ctx, symbol) {
  await ctx.answerCbQuery('Re-fetching logo…');
  const coin = await coinsDb.get(symbol);
  if (!coin) return;
  try {
    const fs = require('fs');
    const path = require('path');
    const pngPath = path.join(config.logosDir, `${symbol.toLowerCase()}.png`);
    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
    await binanceSync.runSync(); // simplest reliable re-fetch path — re-syncs everything, cheap on Binance's free API
    await ctx.reply(`✅ Logo re-fetched for ${symbol}.`);
  } catch (err) {
    await ctx.reply(`⚠️ Could not re-fetch logo: ${err.message}`);
  }
}

async function showThresholdsMenu(ctx) {
  const major = (await settingsDb.get('tier_major_pct')) || config.tierMajorThresholdPct;
  const mid = (await settingsDb.get('tier_mid_pct')) || config.tierMidThresholdPct;
  const micro = (await settingsDb.get('tier_micro_pct')) || config.tierMicroThresholdPct;
  await renderScreen(ctx, 
    `🎯 <b>Thresholds</b>\n\nTier defaults (Bot Mode scales these further):\n` +
      `Major: ${major}%\nMid: ${mid}%\nMicro: ${micro}%`,
    { parse_mode: 'HTML', ...inline.thresholdsMenu }
  );
}

async function promptTierEdit(ctx, tier) {
  await pendingInput.set(`threshold:tier:${tier}`);
  await ctx.reply(`Send the new default % threshold for ${tier}-tier coins (e.g. "3").`, bbtb.cancelOnly);
  await ctx.answerCbQuery();
}

async function showOverrides(ctx) {
  const all = await coinsDb.getAll();
  const overridden = all.filter((c) => c.threshold_type !== 'pct' || true); // all coins technically have a stored value; show top few by symbol for now
  const lines = overridden.slice(0, 15).map((c) => `${c.symbol}: ${c.threshold_value}${c.threshold_type === 'pct' ? '%' : ' USD'}`);
  await renderScreen(ctx, `📋 <b>Per-coin thresholds</b>\n\n${lines.join('\n') || 'None set.'}`, {
    parse_mode: 'HTML',
    ...inline.thresholdsMenu,
  });
}

async function forceSync(ctx) {
  await ctx.answerCbQuery('Syncing with Binance…');
  try {
    const result = await binanceSync.runSync();
    await ctx.reply(
      `✅ Sync complete.\n\n+${result.added.length} new${result.added.length ? `: ${result.added.join(', ')}` : ''}\n` +
        `−${result.removed.length} delisted${result.removed.length ? `: ${result.removed.join(', ')}` : ''}\n` +
        `Total tracked: ${result.total}`
    );
  } catch (err) {
    await ctx.reply(`⚠️ Sync failed: ${err.message}`);
  }
}

module.exports = {
  showHub,
  showCoinList,
  showCoinDetail,
  promptThresholdOverride,
  toggleMute,
  relogo,
  showThresholdsMenu,
  promptTierEdit,
  showOverrides,
  forceSync,
};
