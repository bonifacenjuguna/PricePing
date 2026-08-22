const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const format = require('../utils/format');
const { contrastTextColor } = require('../utils/colors');

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 566;
const LOGO_CIRCLE_CX = 170;
const LOGO_CIRCLE_CY = 195;
const LOGO_CIRCLE_R = 112; // was 82 — bumped up ~35% per redesign request
const LOGO_SIZE = 148; // was 108 — pre-converted PNG is rendered at this square size

const UP_COLOR = '#1F8A4C';
const DOWN_COLOR = '#C62828';

// ---------------------------------------------------------------------------
// Font embedding: Poppins (Bold + Regular), SIL Open Font License 1.1 — see
// src/assets/fonts/OFL.txt. Embedded as base64 data URIs directly in the SVG
// via @font-face so rendering never depends on whatever fonts happen to be
// installed on the Railway image (unlike the old "DejaVu Sans, sans-serif"
// approach, which only worked because DejaVu is a common system default).
// Read once at module load and cached — never re-read per render.
// ---------------------------------------------------------------------------
const FONTS_DIR = path.join(config.assetsDir, 'fonts');
const poppinsBoldBase64 = fs.readFileSync(path.join(FONTS_DIR, 'Poppins-Bold.ttf')).toString('base64');
const poppinsRegularBase64 = fs
  .readFileSync(path.join(FONTS_DIR, 'Poppins-Regular.ttf'))
  .toString('base64');

const FONT_FACES = `
    <style>
      @font-face {
        font-family: 'Poppins';
        font-weight: 700;
        src: url(data:font/ttf;base64,${poppinsBoldBase64}) format('truetype');
      }
      @font-face {
        font-family: 'Poppins';
        font-weight: 400;
        src: url(data:font/ttf;base64,${poppinsRegularBase64}) format('truetype');
      }
    </style>`;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Builds the flat SVG background: brand-colored panel, name/price text,
// direction badge (skipped for stablecoins), and the @PricePing watermark.
// The coin logo itself is NOT drawn here — see render() below, it's
// composited afterward from a pre-converted local PNG so we never need to
// parse/embed a second SVG document at request time.
function buildBackgroundSvg({ coin, price, changeUsd, changePct, direction }) {
  const textColor = contrastTextColor(coin.color);
  const subTextColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.78)' : 'rgba(26,26,26,0.68)';

  const priceStr = `$${format.formatPrice(price)}`;
  const nameStr = escapeXml(coin.name);
  const symbolStr = escapeXml(coin.symbol);

  let badge = '';
  if (!coin.isStable && direction && changePct !== null && changePct !== undefined) {
    const badgeColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
    const arrow = format.directionSymbol(direction);
    const pctStr = format.formatPct(changePct);
    const badgeText = `${arrow} ${pctStr}`;
    const badgeWidth = 60 + badgeText.length * 17;
    const badgeX = CARD_WIDTH - 60 - badgeWidth;
    badge = `
      <rect x="${badgeX}" y="60" width="${badgeWidth}" height="72" rx="36" fill="${badgeColor}" />
      <text x="${badgeX + badgeWidth / 2}" y="106" font-family="Poppins, sans-serif"
            font-size="34" font-weight="700" fill="#FFFFFF" text-anchor="middle">${escapeXml(
              badgeText
            )}</text>`;
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

// coin: entry from config.coins
// price: current price (number)
// changeUsd/changePct/direction: null for stablecoins, or the move since
//   the last alert for everything else
// Returns a PNG Buffer ready to send to Telegram.
async function renderCard({ coin, price, changeUsd, changePct, direction }) {
  const svg = buildBackgroundSvg({ coin, price, changeUsd, changePct, direction });
  const svgBuffer = Buffer.from(svg);

  const base = sharp(svgBuffer).png();

  const logoPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  const overlays = [];

  if (fs.existsSync(logoPath)) {
    const logoBuffer = await sharp(logoPath).resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain' }).toBuffer();
    overlays.push({
      input: logoBuffer,
      left: Math.round(LOGO_CIRCLE_CX - LOGO_SIZE / 2),
      top: Math.round(LOGO_CIRCLE_CY - LOGO_SIZE / 2),
    });
  }

  const pipeline = overlays.length ? base.composite(overlays) : base;
  return pipeline.toBuffer();
}

module.exports = { renderCard, buildBackgroundSvg, CARD_WIDTH, CARD_HEIGHT };
