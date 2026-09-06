const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const config = require('../config');
const logger = require('../utils/logger');
const customCoinsDb = require('../db/customCoins');
const coinTagsDb = require('../db/coinTags');
const thresholdsDb = require('../db/thresholds');
const { coins: builtInCoins } = require('../coins');
const { resolveLogoSvg } = require('../utils/logoFetch');

// Keep in sync with scripts/prepare-assets.js — same reasoning: cards
// composite this onto a 3x-supersampled canvas now (see cardRenderer.js),
// so the source needs real detail at that scale, not an upscaled 256px.
const LOGO_SIZE = 512;

// Snapshot of the original 10 shipped-with-the-bot symbols, captured here
// at require time — before loadCustomCoins()/addCoin() ever mutate
// config.coins (which is the SAME array object as this raw coins.js
// export, not a copy — so we can't tell built-in from custom by checking
// config.coins later, only by checking this snapshot taken before any
// custom coin was ever appended). Used to keep /removecoin from deleting
// one of the originals.
const BUILT_IN_SYMBOLS = new Set(builtInCoins.map((c) => c.symbol));

// config.coins is the SAME array object every other module already holds a
// reference to (marketData.js, poller.js, commands.js, menu.js, ...).
// Mutating it in place with push() means every .find()/.map() call site
// picks up newly-added coins automatically — no need to thread a registry
// object through the whole codebase.

// Called once at boot: loads anything added via /addcoin in a previous
// session and appends it to config.coins.
async function loadCustomCoins() {
  const custom = await customCoinsDb.getAll();
  for (const coin of custom) {
    if (!config.coins.find((c) => c.symbol === coin.symbol)) {
      config.coins.push(coin);
    }
  }
  if (custom.length) {
    logger.info(`Loaded ${custom.length} custom coin(s) from a previous /addcoin`, {
      symbols: custom.map((c) => c.symbol),
    });
  }
}

// Downloads (or falls back to a monogram for) a logo PNG for one coin, same
// as prepare-assets.js does at build time for the static 10.
async function fetchLogo(coin) {
  const { svgContent, source } = await resolveLogoSvg(coin);
  const pngPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  const pngBuffer = await sharp(Buffer.from(svgContent))
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  fs.writeFileSync(pngPath, pngBuffer);
  return source;
}

// symbol/name/binancePair/color required; isStable optional (default false).
// defaultThreshold/thresholdType optional — falls back to a conservative
// 1%-move default so a freshly-added coin doesn't sit alert-silent forever.
async function addCoin({ symbol, name, binancePair, color, isStable, defaultThreshold, thresholdType }) {
  const sym = symbol.toUpperCase();
  if (config.coins.find((c) => c.symbol === sym)) {
    throw new Error(`${sym} is already tracked`);
  }

  const coin = {
    symbol: sym,
    name,
    binancePair: binancePair.toUpperCase(),
    color,
    isStable: !!isStable,
    milestoneStep: null,
  };

  await customCoinsDb.add(coin);
  config.coins.push(coin);

  const type = thresholdType === 'pct' ? 'pct' : 'usd';
  const value = defaultThreshold ?? (type === 'pct' ? 2 : 1);
  await thresholdsDb.ensureDefault(sym, value, type);

  let logoSource = 'fallback';
  try {
    logoSource = await fetchLogo(coin);
  } catch (err) {
    logger.warn(`Could not prepare logo for new coin ${sym}`, { message: err.message });
  }

  return { coin, logoSource };
}

// Undoes /addcoin. Only ever targets a coin that was itself added via
// /addcoin — the original 10 in coins.js aren't removable this way (they
// have thresholds/milestones/defaults wired in more deeply, and accidental
// removal of e.g. BTC would be a much bigger deal than an experimental
// custom coin).
async function removeCoin(symbolRaw) {
  const symbol = (symbolRaw || '').toUpperCase();
  if (BUILT_IN_SYMBOLS.has(symbol)) {
    throw new Error(`${symbol} is one of the bot's original coins and can't be removed this way.`);
  }
  const idx = config.coins.findIndex((c) => c.symbol === symbol);
  if (idx === -1) {
    throw new Error(`${symbol} isn't tracked.`);
  }

  config.coins.splice(idx, 1);
  await customCoinsDb.remove(symbol);
  await coinTagsDb.removeAllForSymbol(symbol);

  const pngPath = path.join(config.logosDir, `${symbol.toLowerCase()}.png`);
  try {
    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
  } catch (err) {
    logger.warn(`Could not remove logo file for ${symbol}`, { message: err.message });
  }

  logger.info(`Removed custom coin ${symbol} (via /removecoin)`);
}

module.exports = { loadCustomCoins, addCoin, removeCoin };
