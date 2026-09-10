// Downloads a coin's logo from CoinGecko (our stated logo source — see
// coingecko.js's fetchMarkets, which returns a ready `image` URL per coin).
// Falls back to a generated monogram if the download fails, so asset prep
// always finishes with a complete, working logo for all 22 assets even
// with zero network access.
const fetch = require('node-fetch');
const sharp = require('sharp');

const REQUEST_TIMEOUT_MS = 8000;
const LOGO_SIZE = 512; // pre-rendered at 512px so upscaling into the 3x-supersampled card canvas stays sharp

async function downloadImageBuffer(url) {
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

// Offline-safe fallback: a flat circle in the coin's brand color with a
// 1-3 letter monogram — no network needed.
function fallbackPngSvg(coin) {
  const initials = coin.symbol.slice(0, coin.symbol.length > 4 ? 2 : 3);
  const textColor = coin.color.toUpperCase() === '#FFFFFF' ? '#111111' : '#FFFFFF';
  return `
<svg width="${LOGO_SIZE}" height="${LOGO_SIZE}" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${LOGO_SIZE / 2}" cy="${LOGO_SIZE / 2}" r="${LOGO_SIZE / 2 - 8}" fill="${coin.color}" />
  <text x="${LOGO_SIZE / 2}" y="${LOGO_SIZE / 2 + 60}" font-family="sans-serif" font-size="160" font-weight="700"
        fill="${textColor}" text-anchor="middle">${initials}</text>
</svg>`;
}

// coin: entry from src/coins.js. logoUrl: from CoinGecko's markets response
// (image field) — resolved by the caller since it requires a CoinGecko API
// call per batch, not per coin.
// Returns { pngBuffer, source: 'coingecko' | 'fallback' }
async function resolveLogoPng(coin, logoUrl) {
  if (logoUrl) {
    try {
      const raw = await downloadImageBuffer(logoUrl);
      const pngBuffer = await sharp(raw)
        .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
        .png()
        .toBuffer();
      return { pngBuffer, source: 'coingecko' };
    } catch (err) {
      return resolveFallback(coin, err.message);
    }
  }
  return resolveFallback(coin, 'no logoUrl provided');
}

async function resolveFallback(coin, reason) {
  const svg = fallbackPngSvg(coin);
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return { pngBuffer, source: 'fallback', reason };
}

module.exports = { resolveLogoPng, LOGO_SIZE };
