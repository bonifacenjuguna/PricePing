const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const format = require('../utils/format');
const { contrastTextColor } = require('../utils/colors');
const { FONT_FACES, escapeXml } = require('../utils/fonts');
const { buildLinePath } = require('./chartRenderer');

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 566;
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
      <rect x="${badgeX}" y="60" width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="${badgeColor}" />
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
  <defs>${FONT_FACES}</defs>
  <rect x="0" y="0" width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" fill="${coin.color}" />
  <circle cx="${logoCx}" cy="${COMPACT_LOGO_CIRCLE_CY}" r="${COMPACT_LOGO_CIRCLE_R}" fill="#FFFFFF" opacity="0.95" />
  <text x="${logoCx + COMPACT_LOGO_CIRCLE_R + 40}" y="${COMPACT_LOGO_CIRCLE_CY + 12}" font-family="Poppins, sans-serif"
        font-size="52" font-weight="700" fill="${textColor}">${symbolStr}</text>
  <text x="${100 + COMPACT_PAD + COMPACT_EXTRA_INSET}" y="300" font-family="Poppins, sans-serif" font-size="84" font-weight="700"
        fill="${textColor}">${escapeXml(priceStr)}</text>
  ${compactBadge}
  ${compactWatermark}
</svg>`;
  }

  return `
<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES}</defs>

  <rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${coin.color}" />

  <!-- logo backing circle (logo PNG composited on top of this at render time) -->
  <circle cx="${LOGO_CIRCLE_CX}" cy="${LOGO_CIRCLE_CY}" r="${LOGO_CIRCLE_R}" fill="#FFFFFF" opacity="0.95" />

  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="172" font-family="Poppins, sans-serif"
        font-size="62" font-weight="700" fill="${textColor}">${nameStr}</text>
  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="218" font-family="Poppins, sans-serif"
        font-size="40" font-weight="400" fill="${subTextColor}">${symbolStr}</text>

  <text x="100" y="430" font-family="Poppins, sans-serif" font-size="96" font-weight="700"
        fill="${textColor}">${escapeXml(priceStr)}</text>

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
      <rect x="${badgeX}" y="60" width="${badgeWidth}" height="64" rx="32" fill="${badgeColor}" />
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
  <defs>${FONT_FACES}</defs>

  <rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${coin.color}" />
  <circle cx="${LOGO_CIRCLE_CX}" cy="${LOGO_CIRCLE_CY}" r="${LOGO_CIRCLE_R}" fill="#FFFFFF" opacity="0.95" />

  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="172" font-family="Poppins, sans-serif"
        font-size="62" font-weight="700" fill="${textColor}">${nameStr}</text>
  <text x="${LOGO_CIRCLE_CX + LOGO_CIRCLE_R + 40}" y="218" font-family="Poppins, sans-serif"
        font-size="40" font-weight="400" fill="${subTextColor}">${symbolStr}</text>

  <text x="100" y="400" font-family="Poppins, sans-serif" font-size="88" font-weight="700"
        fill="${textColor}">${escapeXml(priceStr)}</text>

  ${statsRow}
  ${sparkline}
  ${badge}
  ${watermark}
</svg>`;
}

async function compositeLogo(base, coin, compact) {
  const logoPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  if (!fs.existsSync(logoPath)) return base;
  const size = compact ? COMPACT_LOGO_SIZE : LOGO_SIZE;
  const cy = compact ? COMPACT_LOGO_CIRCLE_CY : LOGO_CIRCLE_CY;
  const cx = compact ? LOGO_CIRCLE_CX + COMPACT_PAD + COMPACT_EXTRA_INSET : LOGO_CIRCLE_CX;
  const logoBuffer = await sharp(logoPath).resize(size, size, { fit: 'contain' }).toBuffer();
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
  const base = sharp(Buffer.from(svg)).png();
  const pipeline = await compositeLogo(base, coin, compact);
  return pipeline.toBuffer();
}

// coin: entry from config.coins, price: number
// stats24h: { priceChangePercent, highPrice, lowPrice } | null (null for stablecoins)
// candles: [{openTime, close}] oldest->newest, for the sparkline (optional)
async function renderRichCard({ coin, price, stats24h, candles }) {
  const svg = buildRichBackgroundSvg({ coin, price, stats24h, candles });
  const base = sharp(Buffer.from(svg)).png();
  const pipeline = await compositeLogo(base, coin, false);
  return pipeline.toBuffer();
}

module.exports = {
  renderCard,
  renderRichCard,
  buildBackgroundSvg,
  buildRichBackgroundSvg,
  CARD_WIDTH,
  CARD_HEIGHT,
};
