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
const botInfo = require('../lib/botInfo');

const SUPERSAMPLE = config.SUPERSAMPLE;

// Compact dims matched against PricePing's actual values (verified by
// re-reading its cardRenderer.js): 1300x360, a more elongated 3.6:1 aspect
// than our original 1200x400 (3.0:1) — plus a deliberate extra center-
// inset (COMPACT_EXTRA_INSET) so content sits well clear of both edges
// instead of hugging the left. Loose is the taller "rich" variant.
const COMPACT_PAD = 50; // extra width added beyond LOOSE_WIDTH to build COMPACT_WIDTH, split across both sides
const COMPACT_WIDTH = 1300;
const COMPACT_HEIGHT = 360;
const COMPACT_EXTRA_INSET = 90; // additional inward push for compact-mode content, beyond the base left margin
const LOOSE_WIDTH = 1080;
const LOOSE_HEIGHT = 566; // exact match to PricePing's CARD_HEIGHT

const LOGO_R_COMPACT = 65;
const LOGO_R_LOOSE = 112; // exact match to PricePing's LOGO_CIRCLE_R

const UP_COLOR = '#1F8A4C';
const DOWN_COLOR = '#C62828';

// NOTE: deliberately NO SVG filter primitives (feDropShadow, feGaussianBlur,
// etc) anywhere in this file. Per the SVG spec, an element referencing an
// unsupported filter doesn't render "without the effect" — it doesn't
// render AT ALL. librsvg's feDropShadow support varies by version, and a
// mismatch on Railway's container caused every filtered element (price
// text, logo circle, badges) to silently vanish, leaving blank cards. Every
// shadow/glow effect below is done with plain duplicated shapes instead —
// guaranteed to render on any SVG engine, no filter support required.
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
    </radialGradient>`;
}

// Filter-free drop shadow for a shape: draws a second, darker, offset copy
// of the same shape behind it. Caller supplies the shape twice (once for
// the shadow color/position, once for the real fill) via shapeFn.
function shapeWithShadow(shapeFn, { fill, shadowOpacity = 0.30, dx = 0, dy = 8 }) {
  return `${shapeFn({ dx, dy, fill: '#000000', opacity: shadowOpacity })}${shapeFn({ dx: 0, dy: 0, fill, opacity: 1 })}`;
}

// Filter-free text shadow: same technique, offset dark copy behind the
// real text.
function textWithShadow(x, y, attrs, fill, content, { dx = 0, dy = 3, shadowOpacity = 0.32 } = {}) {
  return `
    <text x="${x + dx}" y="${y + dy}" ${attrs} fill="#000000" opacity="${shadowOpacity}">${content}</text>
    <text x="${x}" y="${y}" ${attrs} fill="${fill}">${content}</text>`;
}

function buildBadge({ width, direction, alertType, changePct, milestoneLevel, isBigMilestone, isStable, rightMargin = 60, topY = 60 }) {
  if (isStable || (!direction && alertType !== 'milestone')) return { svg: '', width: 0 };
  const badgeColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
  const arrow = format.directionSymbol(direction);
  const isMilestone = alertType === 'milestone';
  const text = isMilestone ? `${arrow} $${format.formatPrice(milestoneLevel)}` : `${arrow} ${format.formatPct(changePct)}`;
  // Exact match to PricePing's badge sizing: height 72/84 (big milestone),
  // font 34/38, width formula 60 + len*(19|17), top-anchored at y=60.
  const h = isBigMilestone ? 84 : 72;
  const fontSize = isBigMilestone ? 38 : 34;
  const w = 60 + text.length * (isBigMilestone ? 19 : 17);
  const x = width - rightMargin - w;
  const rectShape = ({ dx, dy, fill, opacity }) => `<rect x="${x + dx}" y="${topY + dy}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" opacity="${opacity}" />`;
  const svg = `
    ${shapeWithShadow(rectShape, { fill: badgeColor })}
    <text x="${x + w / 2}" y="${topY + h / 2 + 12}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="${fontSize}" font-weight="700"
          fill="#FFFFFF" text-anchor="middle">${escapeXml(text)}</text>`;
  return { svg, width: w };
}

function buildCompactSvg({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone }) {
  const textColor = contrastTextColor(coin.color);
  const subTextColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.78)' : 'rgba(26,26,26,0.68)';
  const priceStr = `$${format.formatPrice(price)}`;
  const badge = buildBadge({ width: COMPACT_WIDTH, direction, alertType, changePct, milestoneLevel, isBigMilestone, isStable: coin.isStable });
  // PricePing's centering technique: push content in from the left by an
  // extra inset on top of the base margin, so it reads as centered within
  // the wide banner rather than hugging the raw edge.
  const leftInset = COMPACT_PAD + COMPACT_EXTRA_INSET;
  const logoCx = 150 + leftInset;
  const logoCy = COMPACT_HEIGHT / 2 - 10;
  const logoCircle = ({ dx, dy, fill, opacity }) => `<circle cx="${logoCx + dx}" cy="${logoCy + dy}" r="${LOGO_R_COMPACT}" fill="${fill}" opacity="${opacity}" />`;
  const botHandle = botInfo.get();
  const watermarkText = botHandle ? `@${botHandle}` : coin.symbol;

  return `
<svg width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" viewBox="0 0 ${COMPACT_WIDTH} ${COMPACT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES()}${buildDefs(coin)}</defs>
  <rect x="0" y="0" width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" fill="url(#bgGrad)" />
  <rect x="0" y="0" width="${COMPACT_WIDTH}" height="${COMPACT_HEIGHT}" fill="url(#vignette)" />
  <circle cx="${logoCx}" cy="${logoCy}" r="${LOGO_R_COMPACT * 1.6}" fill="url(#logoGlow)" />
  ${shapeWithShadow(logoCircle, { fill: '#FFFFFF', shadowOpacity: 0.28 })}
  ${badge.svg}
  ${textWithShadow(logoCx + LOGO_R_COMPACT + 40, COMPACT_HEIGHT / 2, `font-family="Inter, 'DejaVu Sans', sans-serif" font-size="82" font-weight="700"`, textColor, escapeXml(priceStr))}
  <text x="${logoCx + LOGO_R_COMPACT + 40}" y="${COMPACT_HEIGHT / 2 + 34}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="24" font-weight="400"
        fill="${subTextColor}">${escapeXml(coin.symbol)}</text>
  <text x="${COMPACT_WIDTH - leftInset - 10}" y="${COMPACT_HEIGHT - 40}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="26" font-weight="700"
        fill="${textColor}" text-anchor="end" opacity="0.9">${escapeXml(watermarkText)}</text>
</svg>`;
}

function buildLooseSvg({ coin, price, direction, alertType, changePct, milestoneLevel, isBigMilestone, stats24h, candles }) {
  const textColor = contrastTextColor(coin.color);
  const subTextColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.78)' : 'rgba(26,26,26,0.68)';
  const statLabelColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.7)' : 'rgba(26,26,26,0.62)';
  const priceStr = `$${format.formatPrice(price)}`;
  const badge = buildBadge({ width: LOOSE_WIDTH, direction, alertType, changePct, milestoneLevel, isBigMilestone, isStable: coin.isStable });
  const logoCx = 170;
  const logoCy = 195; // exact match to PricePing's LOGO_CIRCLE_CY
  const logoCircle = ({ dx, dy, fill, opacity }) => `<circle cx="${logoCx + dx}" cy="${logoCy + dy}" r="${LOGO_R_LOOSE}" fill="${fill}" opacity="${opacity}" />`;

  // PricePing splits this into two distinct layouts sharing the same
  // canvas: "regular" (threshold/milestone, price sits at y=430, no
  // stats/sparkline) vs "rich" (manual posts only, price at y=400 to make
  // room for a stats row + sparkline below it). We use presence of
  // stats24h/candles as the same signal rather than a separate function,
  // since our mode selection is a style toggle rather than PricePing's
  // per-alert-type split — same visual result either way.
  const hasRichContent = !!(stats24h || (candles && candles.length > 1));
  const priceY = hasRichContent ? 400 : 430;

  let statsRow = '';
  if (stats24h) {
    statsRow = `
      <text x="100" y="470" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="26" font-weight="400" fill="${statLabelColor}">24h High</text>
      <text x="100" y="502" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="32" font-weight="700" fill="${textColor}">$${format.formatPrice(stats24h.highPrice)}</text>
      <text x="330" y="470" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="26" font-weight="400" fill="${statLabelColor}">24h Low</text>
      <text x="330" y="502" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="32" font-weight="700" fill="${textColor}">$${format.formatPrice(stats24h.lowPrice)}</text>`;
  }

  let sparkline = '';
  if (candles && candles.length > 1) {
    const sparkColor = textColor === '#FFFFFF' ? '#FFFFFF' : '#1A1A1A';
    sparkline = `
      <text x="620" y="386" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="24" font-weight="400" fill="${statLabelColor}">Last 24h</text>
      <g opacity="0.9">${buildLinePath(candles, { x: 620, y: 400, width: 400, height: 70, strokeColor: sparkColor, strokeWidth: 4 })}</g>`;
  }

  return `
<svg width="${LOOSE_WIDTH}" height="${LOOSE_HEIGHT}" viewBox="0 0 ${LOOSE_WIDTH} ${LOOSE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>${FONT_FACES()}${buildDefs(coin)}</defs>
  <rect x="0" y="0" width="${LOOSE_WIDTH}" height="${LOOSE_HEIGHT}" fill="url(#bgGrad)" />
  <rect x="0" y="0" width="${LOOSE_WIDTH}" height="${LOOSE_HEIGHT}" fill="url(#vignette)" />
  <circle cx="${logoCx}" cy="${logoCy}" r="${LOGO_R_LOOSE * 1.7}" fill="url(#logoGlow)" />
  ${shapeWithShadow(logoCircle, { fill: '#FFFFFF', shadowOpacity: 0.28 })}
  ${badge.svg}
  ${textWithShadow(logoCx + LOGO_R_LOOSE + 40, 172, `font-family="Inter, 'DejaVu Sans', sans-serif" font-size="62" font-weight="700"`, textColor, escapeXml(coin.name))}
  <text x="${logoCx + LOGO_R_LOOSE + 40}" y="218" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="40" font-weight="400" fill="${subTextColor}">${escapeXml(coin.symbol)}</text>
  ${textWithShadow(100, priceY, `font-family="Inter, 'DejaVu Sans', sans-serif" font-size="96" font-weight="700"`, textColor, escapeXml(priceStr))}
  ${statsRow}
  ${sparkline}
  <text x="${LOOSE_WIDTH - 40}" y="${LOOSE_HEIGHT - 36}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="30" font-weight="700" fill="${textColor}" text-anchor="end" opacity="0.95">${escapeXml(botInfo.get() ? `@${botInfo.get()}` : (stats24h && stats24h.source) || 'live')}</text>
</svg>`;
}

async function compositeLogo(base, coin, cx, cy, r) {
  const logoPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  if (!fs.existsSync(logoPath)) return base;
  const size = Math.round(r * 1.75 * SUPERSAMPLE); // exact ratio match to PricePing (LOGO_SIZE/LOGO_CIRCLE_R ≈ 1.75)
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
  const logoCx = isCompact ? 150 + COMPACT_PAD + COMPACT_EXTRA_INSET : 170;
  const logoCy = isCompact ? COMPACT_HEIGHT / 2 - 10 : 195;
  const logoR = isCompact ? LOGO_R_COMPACT : LOGO_R_LOOSE;
  const pipeline = await compositeLogo(base, coin, logoCx, logoCy, logoR);

  return pipeline
    .sharpen({ sigma: 0.6 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

module.exports = { renderCard, COMPACT_WIDTH, COMPACT_HEIGHT, LOOSE_WIDTH, LOOSE_HEIGHT };
