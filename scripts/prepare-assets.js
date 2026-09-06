// Run this once (locally, or as a Railway build step) to populate
// src/assets/logos/ with a .svg + a pre-converted .png per coin.
//
// This is the ONLY part of the project that needs internet access at
// asset-prep time — the bot itself never fetches or converts logos at
// runtime for the 10 built-in coins (see cardRenderer.js, which just reads
// the local .png). Coins added later via /addcoin DO fetch at runtime,
// through the same resolveLogoSvg() helper — see services/coinRegistry.js.
//
// If a download fails for any reason (network unavailable, source moved,
// symbol not in the icon set), this script falls back to generating a
// simple offline monogram logo locally, so `npm run prepare-assets`
// always finishes with a complete, working asset folder — the bot will
// run correctly even if every single download fails.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
// Deliberately importing coins.js directly, NOT config.js — this script
// must run during Railway's build step, before DATABASE_URL/REDIS_URL/etc.
// are necessarily resolved. config.js hard-exits if those are missing;
// coins.js has no env-var dependency at all.
const { coins, logosDir } = require('../src/coins');
const { resolveLogoSvg } = require('../src/utils/logoFetch');

// Bumped from 256 — cards now composite this logo onto a 3x-supersampled
// canvas (see SUPERSAMPLE in cardRenderer.js), so the source needs enough
// real detail that scaling it up isn't just blurring 256px further.
const LOGO_SIZE = 512;

async function processCoin(coin) {
  const svgPath = path.join(logosDir, `${coin.symbol.toLowerCase()}.svg`);
  const pngPath = path.join(logosDir, `${coin.symbol.toLowerCase()}.png`);

  const { svgContent, source, error } = await resolveLogoSvg(coin);
  if (source === 'fallback') {
    console.warn(`  [${coin.symbol}] download failed (${error}) — using offline fallback logo`);
  }

  fs.writeFileSync(svgPath, svgContent, 'utf8');
  const pngBuffer = await sharp(Buffer.from(svgContent))
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  fs.writeFileSync(pngPath, pngBuffer);

  console.log(`  [${coin.symbol}] OK (${source}) -> ${path.basename(svgPath)}, ${path.basename(pngPath)}`);
  return source;
}

async function main() {
  fs.mkdirSync(logosDir, { recursive: true });

  console.log(`Preparing logos for ${coins.length} coins into ${logosDir}\n`);

  let downloaded = 0;
  let fallback = 0;
  for (const coin of coins) {
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
