// Downloads the Inter font family (Regular + Bold) so card/chart SVGs can
// embed real typography instead of falling back to whatever default font
// librsvg picks on Railway's container (which may have none at all).
// Mirrors logoFetch.js's resilience pattern: if the download fails for any
// reason, fonts.js's FONT_FACES() already degrades gracefully to no
// @font-face rule at all (system default), so a failed font fetch is a
// visual downgrade, never a crash.
const fetch = require('node-fetch');

const REQUEST_TIMEOUT_MS = 10000;

// rsms/inter's GitHub repo publishes raw TTF files directly — a stable,
// direct source with no auth/key needed, same "keyless public" spirit as
// the market-data APIs.
const FONT_SOURCES = [
  { file: 'Inter-Regular.ttf', url: 'https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-Regular.ttf' },
  { file: 'Inter-Bold.ttf', url: 'https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-Bold.ttf' },
];

async function downloadBuffer(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

// Returns [{ file, buffer, ok, reason }] — caller decides what to do with
// failures (prepare-assets.js just logs and skips; the card pipeline
// already handles a fully-missing font file gracefully).
async function fetchAllFonts() {
  const results = [];
  for (const { file, url } of FONT_SOURCES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await downloadBuffer(url);
      results.push({ file, buffer, ok: true });
    } catch (err) {
      results.push({ file, buffer: null, ok: false, reason: err.message });
    }
  }
  return results;
}

module.exports = { fetchAllFonts, FONT_SOURCES };
