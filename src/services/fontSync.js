const fs = require('fs');
const path = require('path');
const { pool } = require('../db/postgres');
const config = require('../config');
const { FONT_SOURCES } = require('../lib/fontFetch');
const logger = require('../lib/logger');

async function syncFontsToDisk() {
  fs.mkdirSync(config.fontsDir, { recursive: true });
  const { rows } = await pool.query('SELECT filename, font_data FROM fonts');
  const byFilename = new Map(rows.map((r) => [r.filename, r.font_data]));

  let written = 0;
  const missing = [];
  for (const { file } of FONT_SOURCES) {
    const fp = path.join(config.fontsDir, file);
    if (fs.existsSync(fp)) continue; // eslint-disable-line no-continue
    const data = byFilename.get(file);
    if (data) {
      fs.writeFileSync(fp, data);
      written += 1;
    } else {
      missing.push(file);
    }
  }

  logger.info('Font sync complete', { writtenFromDb: written, missing: missing.length ? missing : undefined });
  if (missing.length) {
    logger.warn('Some fonts missing from Postgres and local disk — cards will render with the system default font instead of Inter', { files: missing });
  }
}

module.exports = { syncFontsToDisk };
