const logger = require('../utils/logger');
const coinTagsDb = require('../db/coinTags');
const coinMetaDb = require('../db/coinMeta');

// This is CoinGecko, not Binance — Binance's public trading API has no
// coin-category data at all (their website groups coins that way, but
// it's not part of the documented api.binance.com endpoints this bot
// otherwise uses). CoinGecko is free, needs no API key, and is actually
// built for this (categories per coin, market cap rank).
const BASE_URL = 'https://api.coingecko.com/api/v3';
const REQUEST_TIMEOUT_MS = 8000;

// Our fixed taxonomy — matched against CoinGecko's free-form category
// strings (e.g. "Smart Contract Platform", "Decentralized Finance (DeFi)")
// by keyword. A coin can land in more than one; order doesn't matter,
// first match per keyword group is enough to tag it. Keep tag slugs
// filesystem/callback_data-safe (matches sanitizeTag() in commands.js).
const TAXONOMY = [
  { tag: 'layer1', keywords: ['layer 1', 'smart contract platform'] },
  { tag: 'layer2', keywords: ['layer 2'] },
  { tag: 'defi', keywords: ['decentralized finance', 'defi'] },
  { tag: 'ai-depin', keywords: ['artificial intelligence', 'depin', ' ai '] },
  { tag: 'gaming-metaverse', keywords: ['gaming', 'metaverse', 'gamefi', 'play to earn', 'play-to-earn'] },
  { tag: 'memecoins', keywords: ['meme'] },
];

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Symbols collide across CoinGecko's 18,000+ listed coins (many
// "SOL"-adjacent tickers exist besides Solana). /search ranks results by
// relevance/market cap already; among exact ticker matches, picking the
// best market_cap_rank (lowest number = bigger) is the standard
// heuristic and is correct for every symbol this bot actually deals with
// (major, unambiguous assets).
async function resolveCoinGeckoId(symbol) {
  const data = await fetchJson(`${BASE_URL}/search?query=${encodeURIComponent(symbol)}`);
  const coins = (data && data.coins) || [];
  const exact = coins.filter((c) => (c.symbol || '').toUpperCase() === symbol.toUpperCase());
  const candidates = exact.length ? exact : coins;
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity));
  return candidates[0].id;
}

async function fetchDetail(coingeckoId) {
  const data = await fetchJson(
    `${BASE_URL}/coins/${encodeURIComponent(coingeckoId)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`
  );
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    marketCapRank: data.market_cap_rank ?? null,
  };
}

function mapToTaxonomy(rawCategories) {
  const haystack = ` ${rawCategories.join(' ').toLowerCase()} `;
  const matched = [];
  for (const entry of TAXONOMY) {
    if (entry.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) matched.push(entry.tag);
  }
  return matched;
}

// Best-effort, never throws — a categorization failure should never block
// /addcoin from succeeding. Returns { tags, marketCapRank } — tags is []
// and marketCapRank is null if anything along the way didn't work out
// (no network, symbol not found on CoinGecko, rate-limited, etc.).
async function autoTagCoin(symbol) {
  try {
    const coingeckoId = await resolveCoinGeckoId(symbol);
    if (!coingeckoId) return { tags: [], marketCapRank: null };

    const { categories, marketCapRank } = await fetchDetail(coingeckoId);
    await coinMetaDb.upsert(symbol, { coingeckoId, marketCapRank });

    const tags = mapToTaxonomy(categories);
    for (const tag of tags) {
      // eslint-disable-next-line no-await-in-loop
      await coinTagsDb.add(symbol, tag);
    }
    return { tags, marketCapRank };
  } catch (err) {
    logger.warn(`Auto-categorization failed for ${symbol}`, { message: err.message });
    return { tags: [], marketCapRank: null };
  }
}

module.exports = { autoTagCoin, resolveCoinGeckoId, fetchDetail, mapToTaxonomy, TAXONOMY };
