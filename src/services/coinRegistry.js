const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const config = require('../config');
const logger = require('../utils/logger');
const customCoinsDb = require('../db/customCoins');
const thresholdsDb = require('../db/thresholds');
const { resolveLogoSvg } = require('../utils/logoFetch');

// Keep in sync with scripts/prepare-assets.js — same reasoning: cards
// composite this onto a 3x-supersampled canvas now (see cardRenderer.js),
// so the source needs real detail at that scale, not an upscaled 256px.
const LOGO_SIZE = 512;

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

module.exports = { loadCustomCoins, addCoin };
