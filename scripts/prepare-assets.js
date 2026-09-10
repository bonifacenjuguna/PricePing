// Run once at build time (Railway build step) or manually. Downloads all 22
// logos via CoinGecko, stores each as a PNG blob in Postgres (survives
// Railway's ephemeral filesystem across redeploys), and also writes them to
// src/assets/logos/ for this build's immediate use.
//
// Deliberately requires src/coins.js directly, NOT config.js — this can run
// before DATABASE_URL/REDIS_URL are necessarily resolved in the deploy
// pipeline; coins.js has zero env-var dependency. DATABASE_URL is read
// directly here since we DO need Postgres for the blob upload.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { coins, logosDir } = require('../src/coins');
const coingecko = require('../src/services/sources/coingecko');
const { resolveLogoPng } = require('../src/lib/logoFetch');

async function main() {
  fs.mkdirSync(logosDir, { recursive: true });
  console.log(`Preparing logos for ${coins.length} coins...\n`);

  let logoUrls = new Map();
  try {
    const geckoIds = coins.map((c) => c.geckoId).filter(Boolean);
    const markets = await coingecko.fetchMarkets(geckoIds);
    for (const [id, data] of markets) logoUrls.set(id, data.logoUrl);
  } catch (err) {
    console.warn(`Could not fetch logo URLs from CoinGecko (${err.message}) — every coin will use the offline fallback logo.`);
  }

  let pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 })
    : null;
  if (pool) {
    // Background connection errors (e.g. host unreachable during build)
    // fire an 'error' event on the pool; without a handler this crashes
    // the process even though we're about to try/catch the query below.
    pool.on('error', (err) => {
      console.warn(`Postgres pool error (${err.message}) — ignoring, build will continue with local-only assets.`);
    });
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS logos (
          symbol TEXT PRIMARY KEY,
          png_data BYTEA NOT NULL,
          source TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fonts (
          filename TEXT PRIMARY KEY,
          font_data BYTEA NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    } catch (err) {
      console.warn(`Could not reach Postgres (${err.message}) — continuing with local-only asset preparation.`);
      try {
        await pool.end();
      } catch (endErr) {
        // ignore — pool never connected successfully
      }
      pool = null;
    }
  } else {
    console.warn('No DATABASE_URL set — skipping Postgres upload, writing local files only.');
  }

  let downloaded = 0;
  let fallback = 0;
  for (const coin of coins) {
    const logoUrl = logoUrls.get(coin.geckoId);
    const { pngBuffer, source, reason } = await resolveLogoPng(coin, logoUrl);
    if (source === 'fallback') {
      console.warn(`  [${coin.symbol}] using offline fallback logo (${reason || 'no source'})`);
      fallback += 1;
    } else {
      downloaded += 1;
    }

    const pngPath = path.join(logosDir, `${coin.symbol.toLowerCase()}.png`);
    fs.writeFileSync(pngPath, pngBuffer);

    if (pool) {
      await pool.query(
        `INSERT INTO logos (symbol, png_data, source, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (symbol) DO UPDATE SET png_data = $2, source = $3, updated_at = now()`,
        [coin.symbol, pngBuffer, source]
      );
    }
    console.log(`  [${coin.symbol}] OK (${source})`);
  }

  await prepareFonts(pool);
  if (pool) await pool.end();
  console.log(`\nDone. ${downloaded} downloaded from CoinGecko, ${fallback} used the offline fallback.`);
}

async function prepareFonts(pool) {
  // Deliberately NOT attempting a network download here anymore. The
  // previous version fetched Inter-Regular.ttf from rsms/inter's GitHub
  // "docs/font-files" path — which turned out to only contain .woff2
  // files, so every download silently 404'd, the fonts table stayed
  // permanently empty, and — critically — Railway's minimal container has
  // NO system font installed either, so text rendering had nowhere to
  // fall back to. That produced blank/tofu-box text on every card and
  // chart in production.
  //
  // The real fix lives in nixpacks.toml: it installs the `inter` and
  // `dejavu_fonts` packages at the OS level via Nix, which fontconfig (and
  // therefore librsvg, which sharp uses to rasterize our SVGs) resolves
  // automatically — no download, no Postgres blob, no possible 404. This
  // function is kept as a no-op placeholder (rather than deleted outright)
  // in case a verified, stable font URL is ever worth adding as a bonus
  // embedded layer on top of the system font — see FONT_FACES() in
  // src/lib/fonts.js, which already handles "no local font files found"
  // gracefully and costs nothing when unused.
  console.log('\nSkipping font download — fonts are provided by nixpacks.toml (inter + dejavu_fonts) instead. See comment in this function for why.');
}

main().catch((err) => {
  console.error('Asset preparation failed:', err.message);
  process.exit(1);
});
