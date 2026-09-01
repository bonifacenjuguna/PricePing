const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const format = require('../utils/format');
const { contrastTextColor, shade } = require('../utils/colors');
const { FONT_FACES, escapeXml } = require('../utils/fonts');
const { buildLinePath } = require('./chartRenderer');

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 566;
// Every card is rasterized at this many times its declared size (via SVG
// density, not by changing any layout coordinate), then flattened to a
// crisp PNG. Telegram re-encodes every sendPhoto upload to JPEG on its end
// regardless of what we send — that pass is where quality gets lost, and
// it hits soft/low-detail source images hardest. Feeding it a properly
// anti-aliased, high-density source instead of a 1x raster is the only
// lever we have against that: same layout, same aspect ratio, same
// on-screen size, just far more real pixel data for Telegram's encoder to
// work with. 3x roughly doubles render time per card but that's cheap
// relative to a Telegram round trip.
const SUPERSAMPLE = 3;
const LOGO_CIRCLE_CX = 170;
const LOGO_CIRCLE_CY = 195;
const LOGO_CIRCLE_R = 112;
const LOGO_SIZE = 196; // was 148 — fills more of the white circle, margin still visible (~14px ring)
const COMPACT_LOGO_CIRCLE_CY = 115;
const COMPACT_LOGO_CIRCLE_R = 65;
const COMPACT_LOGO_SIZE = 114;
const COMPACT_HEIGHT = 360;
// Telegram crops the left/right edges off very wide images in the chat-list
// bubble preview (the full photo view is untouched). This pad keeps the
// logo/badge/watermark clear of that crop zone by widening the canvas and
// pushing all content inward, rather than shrinking anything.
const COMPACT_PAD = 110;
const COMPACT_WIDTH = CARD_WIDTH + COMPACT_PAD * 2;
// Nudges content further toward center within the same COMPACT_WIDTH/HEIGHT
// canvas — doesn't change overall card size, just how much of the pad is
// "used" as inset vs. left as edge margin.
const COMPACT_EXTRA_INSET = 90;

const UP_COLOR = '#1F8A4C';
const DOWN_COLOR = '#C62828';

// Shared "detailing" defs: a diagonal same-hue gradient (depth, without a
// second brand color), a corner vignette, a soft radial glow to sit behind
// the logo, two "premium dashboard" background accents (a brand-tinted
// corner glow + an opposite-corner soft blob, both smooth gradients — no
// blur filters needed since gradients themselves compress cleanly), a
// faint diagonal sheen (glass-reflection band), a metallic ring gradient
// framing the logo disc, and two drop-shadow filters (one for large flat
// shapes like the logo disc, a lighter one for text/badges). Deliberately
// NOT using a noise/grain texture here — fine per-pixel grain compresses
// terribly under Telegram's forced JPEG re-encode (it either gets smoothed
// away or turns into blocky mosquito-noise artifacts), so it would undo
// the sharpness work. Smooth gradients, a vignette, and blurred shadows
// compress cleanly by comparison — and the contrast on all of them is
// deliberately pushed strong, because anything subtle disappears once
// this gets shrunk to a phone chat-bubble thumbnail.
function buildDetailDefs(coin) {
  return `
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${shade(coin.color, 0.24)}" />
      <stop offset="100%" stop-color="${shade(coin.color, -0.34)}" />
    </linearGradient>
    <radialGradient id="edgeGlow" cx="94%" cy="-6%" r="65%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.24" />
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0.05" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="blobGlow" cx="10%" cy="118%" r="60%">
      <stop offset="0%" stop-color="${shade(coin.color, -0.5)}" stop-opacity="0.55" />
      <stop offset="100%" stop-color="${shade(coin.color, -0.5)}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="sheenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0" />
      <stop offset="38%" stop-color="#FFFFFF" stop-opacity="0" />
      <stop offset="47%" stop-color="#FFFFFF" stop-opacity="0.10" />
      <stop offset="56%" stop-color="#FFFFFF" stop-opacity="0" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="42%" r="75%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.4" />
    </radialGradient>
    <radialGradient id="logoGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.55" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="logoRingGrad" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="${shade(coin.color, 0.5)}" />
      <stop offset="50%" stop-color="${coin.color}" />
      <stop offset="100%" stop-color="${shade(coin.color, -0.45)}" />
    </linearGradient>
    <filter id="shapeShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.35" />
    </filter>
    <filter id="textShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.3" />
    </filter>
    <filter id="ringShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.4" />
    </filter>`;
}

// Full-canvas vignette rect — always the last thing painted before content
// so corners/edges read as receding, which is what actually reads as
// "depth" at a glance rather than needing to inspect the gradient closely.
function buildVignette(width, height) {
  return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#vignette)" />`;
}

// The three background accents that turn the previously-flat brand-color
// panel into something with real depth: a bright glow tucked into the top
// corner (like light catching the edge of a glass panel), a darker
// brand-tinted blob pooling in the opposite corner (grounds the card so it
// doesn't feel like a flat sticker), and a very faint diagonal sheen band
// across the whole card (the same "glass card" reflection used on premium
// UI/fintech cards). Each is a plain smooth gradient — no blur filters
// needed — specifically so it survives Telegram's JPEG re-encode instead
// of degrading into banding or noise.
function buildBackgroundAccents(width, height) {
  return `
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#edgeGlow)" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#blobGlow)" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#sheenGrad)" />`;
}

// Logo "medallion": soft glow, a metallic gradient ring framing the white
// disc (like a coin's rim), a bright glint arc along the ring's upper-left
// edge (simulates a light catching a curved edge), then the white disc
// itself — the coin PNG gets composited on top of this afterward. r is the
// disc radius; the ring sits just outside it with a small gap so it reads
// as a separate frame rather than a thick outline.
function buildLogoBadge(cx, cy, r) {
  const ringR = r + 9;
  const circumference = 2 * Math.PI * ringR;
  const glintLen = circumference * 0.22;
  return `
    <circle cx="${cx}" cy="${cy}" r="${r * 1.7}" fill="url(#logoGlow)" />
    <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="url(#logoRingGrad)" stroke-width="6"
            opacity="0.95" filter="url(#ringShadow)" />
    <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="#FFFFFF" stroke-width="2.5"
            stroke-dasharray="${glintLen.toFixed(1)} ${(circumference - glintLen).toFixed(1)}"
            opacity="0.55" transform="rotate(-135 ${cx} ${cy})" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" opacity="0.95" filter="url(#shapeShadow)" />`;
}

// Builds the flat SVG background: brand-colored panel, name/price text,
// direction badge (skipped for stablecoins), and the @PricePing watermark.
// The coin logo itself is NOT drawn here — see render() below, it's
// composited afterward from a pre-converted local PNG so we never need to
// parse/embed a second SVG document at request time.
function buildBackgroundSvg({ coin, price, changeUsd, changePct, direction, alertType, milestoneLevel, isBigMilestone, compact }) {
  const textColor = contrastTextColor(coin.color);
  const subTextColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.78)' : 'rgba(26,26,26,0.68)';

  const priceStr = `$${format.formatPrice(price)}`;
  const nameStr = escapeXml(coin.name);
  const symbolStr = escapeXml(coin.symbol);

  let badgeInfo = null;
  const isMilestone = alertType === 'milestone';
  if (isMilestone || (!coin.isStable && direction && changePct !== null && changePct !== undefined)) {
    // Big milestones (crossing a multiple of 10x the coin's step) get a
    // celebratory 🎉 prefix and a taller badge instead of the routine one.
    const badgeColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
    const arrow = format.directionSymbol(direction);
    const bigPrefix = isMilestone && isBigMilestone ? '\uD83C\uDF89 ' : '';
    const badgeText = isMilestone ? `${bigPrefix}${arrow} $${format.formatPrice(milestoneLevel)}` : `${arrow} ${format.formatPct(changePct)}`;
    const badgeHeight = isBigMilestone ? 84 : 72;
    const badgeFontSize = isBigMilestone ? 38 : 34;
    const badgeWidth = 60 + badgeText.length * (isBigMilestone ? 19 : 17);
    badgeInfo = { badgeColor, badgeText, badgeHeight, badgeFontSize, badgeWidth };
  }

  // rightMargin: distance from the canvas edge to the badge/watermark's
  // right edge — bigger on the compact card to clear Telegram's crop zone.
  function renderBadge(width, rightMargin) {
    if (!badgeInfo) return '';
    const { badgeColor, badgeText, badgeHeight, badgeFontSize, badgeWidth } = badgeInfo;
    const badgeX = width - rightMargin - badgeWidth;
    return `
      <rect x="${badgeX}" y="60" width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="${badgeColor}" filter="url(#shapeShadow)" />
      <text x="${badgeX + badgeWidth / 2}" y="${60 + badgeHeight / 2 + 12}" font-family="Poppins, sans-serif"
            font-size="${badgeFontSize}" font-weight="700" fill="#FFFFFF" text-anchor="middle">${escapeXml(
              badgeText
            )}</text>`;
  }

  function renderWatermark(width, rightMargin, y, fontSize) {
    return `
    <text x="${width - rightMargin}" y="${y}" font-family="Poppins, sans-serif"
          font-size="${fontSize}" font-weight="700" fill="${textColor}" text-anchor="end"
          opacity="0.95">@PricePing</text>`;
  }

  const badge = renderBadge(CARD_WIDTH, 60);
  const watermark = renderWatermark(CARD_WIDTH, 40, CARD_HEIGHT - 36, 30);

  // Compact style: no name/symbol subtitle block, wider padded canvas so
  // Telegram's feed-preview crop lands on blank margin instead of content,
  // price sits higher — for channels that want less visual noise per post.
  if (compact) {
    const logoCx = LOGO_CIRCLE_CX + COMPACT_PAD + COMPACT_EXTRA_INSET;
    const compactBadge = renderBadge(COMPACT_WIDTH, 60 + COMPACT_PAD + COMPACT_EXTRA_INSET);
    const compactWatermark = renderWatermark(COMPACT_WIDTH, 40 + COMPACT_PAD + COMPACT_EXTRA_INSET, COMPACT_HEIGHT - 44, 26);
    return `
<svg width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" viewBox="0 0 ${COMPACT_WIDTH} ${COMPACT_HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES}${buildDetailDefs(coin)}</defs>
  <rect x="0" y="0" width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" fill="url(#bgGrad)" />
  ${buildBackgroundAccents(COMPACT_WIDTH, COMPACT_HEIGHT)}
  ${buildVignette(COMPACT_WIDTH, COMPACT_HEIGHT)}
  ${buildLogoBadge(logoCx, COMPACT_LOGO_CIRCLE_CY, COMPACT_LOGO_CIRCLE_R)}
  <text x="${logoCx + COMPACT_LOGO_CIRCLE_R + 40}" y="${COMPACT_LOGO_CIRCLE_CY + 12}" font-family="Poppins, sans-serif"
        font-size="52" font-weight="700" fill="${textColor}" filter="url(#textShadow)">${symbolStr}</text>
  <text x="${100 + COMPACT_PAD + COMPACT_EXTRA_INSET}" y="300" font-family="Poppins, sans-serif" font-size="84" font-weight="700"
        fill="${textColor}" filter="url(#textShadow)">${escapeXml(priceStr)}</text>
  ${compactBadge}
  ${compactWatermark}
</svg>`;
  }

  return `
<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES}${buildDetailDefs(coin)}</defs>

  <rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bgGrad)" />
  ${buildBackgroundAccents(CARD_WIDTH, CARD_HEIGHT)}
  ${buildVignette(CARD_WIDTH, CARD_HEIGHT)}

  <!-- logo medallion (logo PNG composited on top of this at render time) -->
  ${buildLogoBadge(LOGO_CIRCLE_CX, LOGO_CIRCLE_CY, LOGO_CIRCLE_R)}

  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="172" font-family="Poppins, sans-serif"
        font-size="62" font-weight="700" fill="${textColor}" filter="url(#textShadow)">${nameStr}</text>
  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="218" font-family="Poppins, sans-serif"
        font-size="40" font-weight="400" fill="${subTextColor}">${symbolStr}</text>

  <text x="100" y="430" font-family="Poppins, sans-serif" font-size="96" font-weight="700"
        fill="${textColor}" filter="url(#textShadow)">${escapeXml(priceStr)}</text>

  ${badge}
  ${watermark}
</svg>`;
}

// ---------------------------------------------------------------------------
// Rich card for manual /post — same brand-panel layout, plus a 24h stat row
// (high/low/% change) and a small embedded sparkline. Distinct from the
// automatic threshold-alert card on purpose: a manual post is a deliberate
// piece of content, not a fired trigger, so it earns the extra context.
// ---------------------------------------------------------------------------
function buildRichBackgroundSvg({ coin, price, stats24h, candles }) {
  const textColor = contrastTextColor(coin.color);
  const subTextColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.78)' : 'rgba(26,26,26,0.68)';
  const statLabelColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.7)' : 'rgba(26,26,26,0.62)';

  const priceStr = `$${format.formatPrice(price)}`;
  const nameStr = escapeXml(coin.name);
  const symbolStr = escapeXml(coin.symbol);

  let badge = '';
  let statsRow = '';
  if (!coin.isStable && stats24h) {
    const direction = stats24h.priceChangePercent >= 0 ? 'up' : 'down';
    const badgeColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
    const arrow = format.directionSymbol(direction);
    const pctStr = format.formatPct(stats24h.priceChangePercent);
    const badgeText = `24h ${arrow} ${pctStr}`;
    const badgeWidth = 60 + badgeText.length * 15;
    const badgeX = CARD_WIDTH - 60 - badgeWidth;
    badge = `
      <rect x="${badgeX}" y="60" width="${badgeWidth}" height="64" rx="32" fill="${badgeColor}" filter="url(#shapeShadow)" />
      <text x="${badgeX + badgeWidth / 2}" y="102" font-family="Poppins, sans-serif"
            font-size="28" font-weight="700" fill="#FFFFFF" text-anchor="middle">${escapeXml(
              badgeText
            )}</text>`;

    statsRow = `
      <text x="100" y="470" font-family="Poppins, sans-serif" font-size="26" font-weight="400"
            fill="${statLabelColor}">24h High</text>
      <text x="100" y="502" font-family="Poppins, sans-serif" font-size="32" font-weight="700"
            fill="${textColor}">$${format.formatPrice(stats24h.highPrice)}</text>
      <text x="330" y="470" font-family="Poppins, sans-serif" font-size="26" font-weight="400"
            fill="${statLabelColor}">24h Low</text>
      <text x="330" y="502" font-family="Poppins, sans-serif" font-size="32" font-weight="700"
            fill="${textColor}">$${format.formatPrice(stats24h.lowPrice)}</text>`;
  }

  let sparkline = '';
  if (candles && candles.length > 1) {
    const sparkColor = textColor === '#FFFFFF' ? '#FFFFFF' : '#1A1A1A';
    const sparkX = 620;
    const sparkY = 440;
    const sparkWidth = 400;
    const sparkHeight = 90;
    sparkline = `
      <text x="${sparkX}" y="${sparkY - 14}" font-family="Poppins, sans-serif" font-size="24"
            font-weight="400" fill="${statLabelColor}">Last 24h</text>
      <g opacity="0.9">
        ${buildLinePath(candles, {
          x: sparkX,
          y: sparkY,
          width: sparkWidth,
          height: sparkHeight,
          strokeColor: sparkColor,
          strokeWidth: 4,
        })}
      </g>`;
  }

  const watermark = `
    <text x="${CARD_WIDTH - 40}" y="${CARD_HEIGHT - 36}" font-family="Poppins, sans-serif"
          font-size="30" font-weight="700" fill="${textColor}" text-anchor="end"
          opacity="0.95">@PricePing</text>`;

  return `
<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES}${buildDetailDefs(coin)}</defs>

  <rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bgGrad)" />
  ${buildBackgroundAccents(CARD_WIDTH, CARD_HEIGHT)}
  ${buildVignette(CARD_WIDTH, CARD_HEIGHT)}
  ${buildLogoBadge(LOGO_CIRCLE_CX, LOGO_CIRCLE_CY, LOGO_CIRCLE_R)}

  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="172" font-family="Poppins, sans-serif"
        font-size="62" font-weight="700" fill="${textColor}" filter="url(#textShadow)">${nameStr}</text>
  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="218" font-family="Poppins, sans-serif"
        font-size="40" font-weight="400" fill="${subTextColor}">${symbolStr}</text>

  <text x="100" y="400" font-family="Poppins, sans-serif" font-size="88" font-weight="700"
        fill="${textColor}" filter="url(#textShadow)">${escapeXml(priceStr)}</text>

  ${statsRow}
  ${sparkline}
  ${badge}
  ${watermark}
</svg>`;
}

// base is rasterized at SUPERSAMPLE x the layout's declared coordinates
// (via SVG density — see renderCard/renderRichCard), so every coordinate
// used to place the logo here has to be scaled up to match, or it'd land
// in the top-left corner of a canvas 3x bigger than it expects.
async function compositeLogo(base, coin, compact) {
  const logoPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  if (!fs.existsSync(logoPath)) return base;
  const size = (compact ? COMPACT_LOGO_SIZE : LOGO_SIZE) * SUPERSAMPLE;
  const cy = (compact ? COMPACT_LOGO_CIRCLE_CY : LOGO_CIRCLE_CY) * SUPERSAMPLE;
  const cx = (compact ? LOGO_CIRCLE_CX + COMPACT_PAD + COMPACT_EXTRA_INSET : LOGO_CIRCLE_CX) * SUPERSAMPLE;
  // kernel: 'lanczos3' — the source PNG is pre-rendered at LOGO_SIZE (see
  // prepare-assets.js / coinRegistry.js); resizing it up to match the
  // supersampled canvas benefits from the sharper kernel same as the final
  // downsize does, rather than libvips' default.
  const logoBuffer = await sharp(logoPath)
    .resize(size, size, { fit: 'contain', kernel: 'lanczos3' })
    .toBuffer();
  return base.composite([
    {
      input: logoBuffer,
      left: Math.round(cx - size / 2),
      top: Math.round(cy - size / 2),
    },
  ]);
}

// coin: entry from config.coins
// price: current price (number)
// changeUsd/changePct/direction: null for stablecoins, or the move since
//   the last alert for everything else
// isBigMilestone: for milestone alerts only — a "big" round-number crossing
// compact: render the smaller no-subtitle style (see settingsDb.getCompactCards)
// Returns a PNG Buffer ready to send to Telegram.
async function renderCard({ coin, price, changeUsd, changePct, direction, alertType, milestoneLevel, isBigMilestone, compact }) {
  const svg = buildBackgroundSvg({ coin, price, changeUsd, changePct, direction, alertType, milestoneLevel, isBigMilestone, compact });
  const base = sharp(Buffer.from(svg), { density: 72 * SUPERSAMPLE });
  const pipeline = await compositeLogo(base, coin, compact);
  return pipeline
    .sharpen({ sigma: 0.6 }) // small edge-contrast boost so text/lines read cleanly after Telegram's JPEG pass
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

// coin: entry from config.coins, price: number
// stats24h: { priceChangePercent, highPrice, lowPrice } | null (null for stablecoins)
// candles: [{openTime, close}] oldest->newest, for the sparkline (optional)
async function renderRichCard({ coin, price, stats24h, candles }) {
  const svg = buildRichBackgroundSvg({ coin, price, stats24h, candles });
  const base = sharp(Buffer.from(svg), { density: 72 * SUPERSAMPLE });
  const pipeline = await compositeLogo(base, coin, false);
  return pipeline
    .sharpen({ sigma: 0.6 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

module.exports = {
  renderCard,
  renderRichCard,
  buildBackgroundSvg,
  buildRichBackgroundSvg,
  CARD_WIDTH,
  CARD_HEIGHT,
};
