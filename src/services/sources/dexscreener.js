// Reserved for later: trending/new DEX-listed tokens outside the fixed
// 20+2 coin list. Not wired into the current fallback chains — kept as a
// ready adapter so adding a "Trending" feature later is a menu screen +
// this file, not a new integration from scratch.
const fetch = require('node-fetch');

const BASE = 'https://api.dexscreener.com/latest/dex';
const TIMEOUT_MS = 6000;

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function searchPairs(query) {
  const d = await fetchJson(`${BASE}/search?q=${encodeURIComponent(query)}`);
  return d.pairs || [];
}

module.exports = { searchPairs };
