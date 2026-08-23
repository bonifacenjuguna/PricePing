// Shared between scripts/prepare-assets.js (build time, all 10 static
// coins) and services/coinRegistry.js (runtime, a single coin added via
// /addcoin). Kept in one place so both paths fall back identically if a
// download fails or there's no network.
const REQUEST_TIMEOUT_MS = 8000;

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
  <text x="128" y="150" font-family="DejaVu Sans, sans-serif" font-size="88" font-weight="700"
        fill="${textColor}" text-anchor="middle">${initials}</text>
</svg>`;
}

// Returns { svgContent, source: 'downloaded' | 'fallback' } — never throws.
async function resolveLogoSvg(coin) {
  try {
    const svgContent = await downloadSvg(coin.symbol);
    return { svgContent, source: 'downloaded' };
  } catch (err) {
    return { svgContent: fallbackSvg(coin), source: 'fallback', error: err.message };
  }
}

module.exports = { iconUrlFor, downloadSvg, fallbackSvg, resolveLogoSvg };
