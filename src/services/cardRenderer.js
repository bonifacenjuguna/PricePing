// Renders threshold/milestone alert cards (and manual "share price" cards)
// as high-quality PNGs. Two modes, selected in Settings:
//   compact (default) — short/wide, price-dominant, minimal (see the
//     height reference the user provided — a banner-style card)
//   loose — taller, adds 24h high/low stats + a mini sparkline
// Both share ONE visual language: clean price + logo + badge, no
// decorative illustrations — deliberately simpler than some references
// reviewed during planning.
//
// Pipeline: build an SVG string -> rasterize via sharp at SUPERSAMPLE x
// declared size (density trick, not scaled coordinates) -> composite the
// pre-converted local logo PNG on top -> light sharpen pass -> PNG out.
// The supersample step is the actual "high quality" lever: Telegram
// re-encodes every sendPhoto to JPEG on its end regardless of what we send,
// and that pass hits a soft/low-detail 1x source hardest. Feeding it 3x the
// real pixel data is what survives that re-encode looking crisp.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const format = require('../lib/format');
const { contrastTextColor, shade } = require('../lib/colors');
const { FONT_FACES, escapeXml } = require('../lib/fonts');
const { buildLinePath } = require('./chartRenderer');

const SUPERSAMPLE = config.SUPERSAMPLE;

// Compact dims chosen to match the height reference from planning — short
// and wide, single dominant price. Loose is the taller "rich" variant.
const COMPACT_WIDTH = 1200;
const COMPACT_HEIGHT = 400;
const LOOSE_WIDTH = 1080;
const LOOSE_HEIGHT = 620;

const LOGO_R_COMPACT = 70;
const LOGO_R_LOOSE = 100;

const UP_COLOR = '#1F8A4C';
const DOWN_COLOR = '#C62828';

function buildDefs(coin) {
  return `
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${shade(coin.color, 0.22)}" />
      <stop offset="100%" stop-color="${shade(coin.color, -0.32)}" />
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="40%" r="75%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.38" />
    </radialGradient>
    <radialGradient id="logoGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <filter id="shapeShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.32" />
    </filter>
    <filter id="textShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.28" />
    </filter>`;
}

function buildBadge({ width, direction, alertType, changePct, milestoneLevel, isBigMilestone, isStable }) {
  if (isStable || (!direction && alertType !== 'milestone')) return { svg: '', width: 0 };
  const badgeColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
  const arrow = format.directionSymbol(direction);
  const isMilestone = alertType === 'milestone';
  const bigPrefix = isMilestone && isBigMilestone ? '\uD83C\uDF89 ' : '';
  const text = isMilestone ? `${bigPrefix}${arrow} $${format.formatPrice(milestoneLevel)}` : `${arrow} ${format.formatPct(changePct)}`;
  const h = isBigMilestone ? 78 : 66;
  const fontSize = isBigMilestone ? 34 : 30;
  const w = 56 + text.length * (isBigMilestone ? 18 : 16);
  const x = width - 50 - w;
  const svg = `
    <rect x="${x}" y="46" width="${w}" height="${h}" rx="${h / 2}" fill="${badgeColor}" filter="url(#shapeShadow)" />
    <text x="${x + w / 2}" y="${46 + h / 2 + 10}" font-family="Inter, sans-serif" font-size="${fontSize}" font-weight="700"
          fill="#FFFFFF" text-anchor="middle">${escapeXml(text)}</text>`;
  return { svg, width: w };
}

function buildCompactSvg({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone }) {
  const textColor = contrastTextColor(coin.color);
  const priceStr = `$${format.formatPrice(price)}`;
  const badge = buildBadge({ width: COMPACT_WIDTH, direction, alertType, changePct, milestoneLevel, isBigMilestone, isStable: coin.isStable });
  const logoCx = 150;
  const logoCy = COMPACT_HEIGHT / 2 - 20;

  return `
<svg width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" viewBox="0 0 ${COMPACT_WIDTH} ${COMPACT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES()}${buildDefs(coin)}</defs>
  <rect x="0" y="0" width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" fill="url(#bgGrad)" />
  <rect x="0" y="0" width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" fill="url(#vignette)" />
  <circle cx="${logoCx}" cy="${logoCy}" r="${LOGO_R_COMPACT * 1.6}" fill="url(#logoGlow)" />
  <circle cx="${logoCx}" cy="${logoCy}" r="${LOGO_R_COMPACT}" fill="#FFFFFF" opacity="0.95" filter="url(#shapeShadow)" />
  ${badge.svg}
  <text x="${logoCx + LOGO_R_COMPACT + 50}" y="${COMPACT_HEIGHT / 2 + 5}" font-family="Inter, sans-serif" font-size="96" font-weight="700"
        fill="${textColor}" filter="url(#textShadow)">${escapeXml(priceStr)}</text>
  <text x="${COMPACT_WIDTH - 50}" y="${COMPACT_HEIGHT - 34}" font-family="Inter, sans-serif" font-size="26" font-weight="700"
        fill="${textColor}" text-anchor="end" opacity="0.9">${escapeXml(coin.symbol)}</text>
</svg>`;
}

function buildLooseSvg({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone, stats24h, candles }) {
  const textColor = contrastTextColor(coin.color);
  const subTextColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.75)' : 'rgba(26,26,26,0.65)';
  const statLabelColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.68)' : 'rgba(26,26,26,0.6)';
  const priceStr = `$${format.formatPrice(price)}`;
  const badge = buildBadge({ width: LOOSE_WIDTH, direction, alertType, changePct, milestoneLevel, isBigMilestone, isStable: coin.isStable });
  const logoCx = 170;
  const logoCy = 190;

  let statsRow = '';
  if (stats24h) {
    statsRow = `
      <text x="100" y="470" font-family="Inter, sans-serif" font-size="24" fill="${statLabelColor}">24h High</text>
      <text x="100" y="504" font-family="Inter, sans-serif" font-size="30" font-weight="700" fill="${textColor}">$${format.formatPrice(stats24h.highPrice)}</text>
      <text x="330" y="470" font-family="Inter, sans-serif" font-size="24" fill="${statLabelColor}">24h Low</text>
      <text x="330" y="504" font-family="Inter, sans-serif" font-size="30" font-weight="700" fill="${textColor}">$${format.formatPrice(stats24h.lowPrice)}</text>`;
  }

  let sparkline = '';
  if (candles && candles.length > 1) {
    const sparkColor = textColor === '#FFFFFF' ? '#FFFFFF' : '#1A1A1A';
    sparkline = `<g opacity="0.9">${buildLinePath(candles, { x: 610, y: 400, width: 400, height: 70, strokeColor: sparkColor, strokeWidth: 4 })}</g>`;
  }

  return `
<svg width="${LOOSE_WIDTH}" height="${LOOSE_HEIGHT}" viewBox="0 0 ${LOOSE_WIDTH} ${LOOSE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES()}${buildDefs(coin)}</defs>
  <rect x="0" y="0" width="${LOOSE_WIDTH}" height="${LOOSE_HEIGHT}" fill="url(#bgGrad)" />
  <rect x="0" y="0" width="${LOOSE_WIDTH}" height="${LOOSE_HEIGHT}" fill="url(#vignette)" />
  <circle cx="${logoCx}" cy="${logoCy}" r="${LOGO_R_LOOSE * 1.6}" fill="url(#logoGlow)" />
  <circle cx="${logoCx}" cy="${logoCy}" r="${LOGO_R_LOOSE}" fill="#FFFFFF" opacity="0.95" filter="url(#shapeShadow)" />
  ${badge.svg}
  <text x="${logoCx + LOGO_R_LOOSE + 40}" y="172" font-family="Inter, sans-serif" font-size="56" font-weight="700" fill="${textColor}" filter="url(#textShadow)">${escapeXml(coin.name)}</text>
  <text x="${logoCx + LOGO_R_LOOSE + 40}" y="216" font-family="Inter, sans-serif" font-size="34" fill="${subTextColor}">${escapeXml(coin.symbol)}</text>
  <text x="100" y="400" font-family="Inter, sans-serif" font-size="80" font-weight="700" fill="${textColor}" filter="url(#textShadow)">${escapeXml(priceStr)}</text>
  ${statsRow}
  ${sparkline}
  <text x="${LOOSE_WIDTH - 40}" y="${LOOSE_HEIGHT - 36}" font-family="Inter, sans-serif" font-size="26" fill="${textColor}" text-anchor="end" opacity="0.85">via ${escapeXml((stats24h && stats24h.source) || 'live')}</text>
</svg>`;
}

async function compositeLogo(base, coin, cx, cy, r) {
  const logoPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  if (!fs.existsSync(logoPath)) return base;
  const size = Math.round(r * 1.7 * SUPERSAMPLE);
  const scaledCx = cx * SUPERSAMPLE;
  const scaledCy = cy * SUPERSAMPLE;
  const logoBuffer = await sharp(logoPath).resize(size, size, { fit: 'contain', kernel: 'lanczos3' }).toBuffer();
  return base.composite([{ input: logoBuffer, left: Math.round(scaledCx - size / 2), top: Math.round(scaledCy - size / 2) }]);
}

// mode: 'compact' | 'loose'
// alertType: 'threshold' | 'milestone' | 'manual'
async function renderCard({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone, stats24h, candles, mode = 'compact' }) {
  const isCompact = mode === 'compact';
  const svg = isCompact
    ? buildCompactSvg({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone })
    : buildLooseSvg({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone, stats24h, candles });

  const base = sharp(Buffer.from(svg), { density: 72 * SUPERSAMPLE });
  const logoCx = isCompact ? 150 : 170;
  const logoCy = isCompact ? COMPACT_HEIGHT / 2 - 20 : 190;
  const logoR = isCompact ? LOGO_R_COMPACT : LOGO_R_LOOSE;
  const pipeline = await compositeLogo(base, coin, logoCx, logoCy, logoR);

  return pipeline
    .sharpen({ sigma: 0.6 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

module.exports = { renderCard, COMPACT_WIDTH, COMPACT_HEIGHT, LOOSE_WIDTH, LOOSE_HEIGHT };
