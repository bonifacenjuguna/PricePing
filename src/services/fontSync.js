const fs = require('fs');
const path = require('path');
const { pool } = require('../db/postgres');
const config = require('../config');
const { FONT_SOURCES } = require('../lib/fontFetch');
const logger = require('../lib/logger');

// Optional bonus layer only: if font blobs happen to exist in Postgres
// (e.g. someone manually uploaded verified font files later), sync them to
// local disk so cardRenderer.js's FONT_FACES() can embed them directly in
// the SVG. Nothing populates this table by default anymore — see the
// comment in scripts/prepare-assets.js's prepareFonts() for why the old
// automatic download was removed. Actual text rendering now depends on
// nixpacks.toml's system-level `inter`/`dejavu_fonts` packages, not this.
// An empty result here is the normal, expected case, not a problem.
async function syncFontsToDisk() {
  fs.mkdirSync(config.fontsDir, { recursive: true });
  const { rows } = await pool.query('SELECT filename, font_data FROM fonts');
  const byFilename = new Map(rows.map((r) => [r.filename, r.font_data]));

  let written = 0;
  for (const { file } of FONT_SOURCES) {
    const fp = path.join(config.fontsDir, file);
    if (fs.existsSync(fp)) continue; // eslint-disable-line no-continue
    const data = byFilename.get(file);
    if (data) {
      fs.writeFileSync(fp, data);
      written += 1;
    }
  }

  if (written > 0) {
    logger.info('Font sync: wrote bonus embedded fonts from Postgres', { count: written });
  }
}

module.exports = { syncFontsToDisk };
