// Run this once (locally, or as a Railway build step) to populate
// src/assets/logos/ with a .svg + a pre-converted .png per coin.
//
// This is the ONLY part of the project that needs internet access at
// asset-prep time — the bot itself never fetches or converts logos at
// runtime (see cardRenderer.js, which just reads the local .png).
//
// If a download fails for any reason (network unavailable, source moved,
// symbol not in the icon set), this script falls back to generating a
// simple offline monogram logo locally, so `npm run prepare-assets`
// always finishes with a complete, working asset folder — the bot will
// run correctly even if every single download fails.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { coins } = require('../src/coins');

// This script only needs static coin data and the asset directory paths —
// it must not require src/config.js, since that module loads DATABASE_URL
// and REDIS_URL at import time and will abort the process if they aren't
// set. Those are runtime dependencies, not build-time ones, and this
// script runs during `npm run prepare-assets` at build time, before the
// databases may even be provisioned.
const config = {
  coins,
  assetsDir: path.join(__dirname, '..', 'src', 'assets'),
  logosDir: path.join(__dirname, '..', 'src', 'assets', 'logos'),
};

const LOGO_SIZE = 256;
const REQUEST_TIMEOUT_MS = 8000;

// Free, MIT-licensed icon set commonly used for this exact purpose.
// One flat-color SVG per symbol, lowercase filename.
function iconUrlFor(symbol) {
  return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${symbol.toLowerCase()}.svg`;
}

async function downloadSvg(symbol) {
  const url = iconUrlFor(symbol);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('<svg')) throw new Error('response was not an SVG document');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// Offline-safe fallback: a flat circle in the coin's brand color with the
// first 1-2 letters of the symbol as a monogram. No network needed.
function fallbackSvg(coin) {
  const initials = coin.symbol.slice(0, coin.symbol.length > 3 ? 2 : 3);
  const textColor = coin.color.toUpperCase() === '#FFFFFF' ? '#111111' : '#FFFFFF';
  return `
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <circle cx="128" cy="128" r="120" fill="${coin.color}" />
  <text x="128" y="150" font-family="Arial, sans-serif" font-size="88" font-weight="700"
        fill="${textColor}" text-anchor="middle">${initials}</text>
</svg>`;
}

async function processCoin(coin) {
  const svgPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.svg`);
  const pngPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);

  let svgContent;
  let source;
  try {
    svgContent = await downloadSvg(coin.symbol);
    source = 'downloaded';
  } catch (err) {
    console.warn(`  [${coin.symbol}] download failed (${err.message}) — using offline fallback logo`);
    svgContent = fallbackSvg(coin);
    source = 'fallback';
  }

  fs.writeFileSync(svgPath, svgContent, 'utf8');
  const pngBuffer = await sharp(Buffer.from(svgContent))
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(pngPath, pngBuffer);

  console.log(`  [${coin.symbol}] OK (${source}) -> ${path.basename(svgPath)}, ${path.basename(pngPath)}`);
  return source;
}

async function main() {
  fs.mkdirSync(config.logosDir, { recursive: true });

  console.log(`Preparing logos for ${config.coins.length} coins into ${config.logosDir}\n`);

  let downloaded = 0;
  let fallback = 0;
  for (const coin of config.coins) {
    const source = await processCoin(coin);
    if (source === 'downloaded') downloaded += 1;
    else fallback += 1;
  }

  console.log(`\nDone. ${downloaded} downloaded, ${fallback} used the offline fallback.`);
  if (fallback > 0) {
    console.log(
      'Coins using the fallback still have a working (if plain) logo — re-run this script later ' +
        'with a working internet connection to replace them with real brand logos.'
    );
  }
}

main().catch((err) => {
  console.error('Asset preparation failed:', err.message);
  process.exit(1);
});
