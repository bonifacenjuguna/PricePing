// Runs once at boot, BEFORE the bot starts accepting traffic. Railway's
// filesystem is ephemeral (wiped on every redeploy/restart), so we can't
// rely on scripts/prepare-assets.js's local file output surviving between
// deploys — Postgres (populated by that script) is the actual source of
// truth. This just re-materializes the local disk cache that cardRenderer.js
// and chartRenderer.js read from, so those stay simple synchronous file
// reads instead of hitting Postgres on every single card render.
const fs = require('fs');
const path = require('path');
const { pool } = require('../db/postgres');
const { coins, logosDir } = require('../coins');
const logger = require('../lib/logger');

async function syncLogosToDisk() {
  fs.mkdirSync(logosDir, { recursive: true });
  const { rows } = await pool.query('SELECT symbol, png_data FROM logos');
  const bySymbol = new Map(rows.map((r) => [r.symbol, r.png_data]));

  let written = 0;
  let missing = [];
  for (const coin of coins) {
    const pngPath = path.join(logosDir, `${coin.symbol.toLowerCase()}.png`);
    if (fs.existsSync(pngPath)) continue; // this build's own prepare-assets output already wrote it
    const data = bySymbol.get(coin.symbol);
    if (data) {
      fs.writeFileSync(pngPath, data);
      written += 1;
    } else {
      missing.push(coin.symbol);
    }
  }

  logger.info('Logo sync complete', { writtenFromDb: written, missing: missing.length ? missing : undefined });
  if (missing.length) {
    logger.warn('Some coins have no logo in Postgres or local disk — cards will fall back to no-logo rendering for these', { symbols: missing });
  }
}

module.exports = { syncLogosToDisk };
