const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const format = require('../utils/format');
const { shade } = require('../utils/colors');
const { FONT_FACES, escapeXml } = require('../utils/fonts');

const CHART_WIDTH = 1080;
const CHART_HEIGHT = 640;
// Same crop problem as the compact alert card: Telegram's chat-list bubble
// preview clips the left/right edges of an image, and this chart's title,
// price/pct, and watermark all sat flush against them. Widen the canvas and
// shift every element inward by CHART_PAD so the crop lands on blank
// margin — the plot area itself keeps its original CHART_WIDTH geometry,
// just offset.
const CHART_PAD = 90;
const CHART_CANVAS_WIDTH = CHART_WIDTH + CHART_PAD * 2;
const PADDING = { top: 176, right: 60, bottom: 96, left: 104 };
// See SUPERSAMPLE in cardRenderer.js — same reasoning applies here: render
// at 3x via SVG density (layout coordinates untouched), so the thin grid
// lines/candle wicks and sparkline curve survive Telegram's JPEG re-encode
// cleanly instead of turning fuzzy.
const SUPERSAMPLE = 3;
const LOGO_R = 44;
const LOGO_CX = 60 + CHART_PAD + LOGO_R;
const LOGO_CY = 66;

const GRID_COLOR = 'rgba(255,255,255,0.10)';
const GRID_COLOR_STRONG = 'rgba(255,255,255,0.18)';
const AXIS_TEXT_COLOR = 'rgba(255,255,255,0.55)';
const UP_COLOR = '#3DDC84';
const DOWN_COLOR = '#FF5C5C';
const UP_BADGE = '#1F8A4C';
const DOWN_BADGE = '#C62828';

// Period presets for /chart SYMBOL [period]. interval/limit chosen so each
// preset stays well under a few hundred candles — plenty of resolution for
// a 1080px-wide chart without over-fetching Binance.
const PERIOD_PRESETS = {
  '1h': { interval: '1m', limit: 60, label: 'Last 1 hour', timeFmt: 'time' },
  '24h': { interval: '15m', limit: 96, label: 'Last 24 hours', timeFmt: 'time' },
  '7d': { interval: '2h', limit: 84, label: 'Last 7 days', timeFmt: 'date' },
  '30d': { interval: '6h', limit: 120, label: 'Last 30 days', timeFmt: 'date' },
};

// Chart visual styles offered to the user via the /chart flow.
const CHART_STYLES = {
  line: { key: 'line', label: '\uD83D\uDCC8 Line' },
  candle: { key: 'candle', label: '\uD83D\uDD6F\uFE0F Candles' },
};

function scaleY(value, min, max, top, bottom) {
  if (max === min) return (top + bottom) / 2;
  return bottom - ((value - min) / (max - min)) * (bottom - top);
}

function formatAxisTime(ms, timeFmt) {
  const d = new Date(ms);
  if (timeFmt === 'date') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function computeLinePoints(candles, x, y, width, height) {
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  return computeLinePointsInRange(candles, min, max, x, y, width, height);
}

// Same as computeLinePoints but scaled against an externally-supplied
// min/max — used by the full chart's line body so the curve shares the
// exact same vertical scale as the price grid (which spans the period's
// high/low, not just the close series) instead of stretching to fill the
// plot on its own narrower close-only range.
function computeLinePointsInRange(candles, min, max, x, y, width, height) {
  return candles.map((c, i) => {
    const px = x + (i / Math.max(candles.length - 1, 1)) * width;
    const py = scaleY(c.close, min, max, y, y + height);
    return [px, py];
  });
}

// Builds just the <polyline>/<path> + optional fill for a price series,
// scaled into an arbitrary box, as a single SVG-fragment string. Used both
// standalone (embedded at small size inside cardRenderer.js's rich card as
// a sparkline — hence no axes/labels/fonts here) and internally below by
// the full /chart renderer's line style. Kept string-returning (not an
// object) since cardRenderer.js interpolates the result directly into its
// own template literal.
function buildLinePath(candles, { x, y, width, height, strokeColor, strokeWidth = 3, fill = false }) {
  if (!candles.length) return '';
  const points = computeLinePoints(candles, x, y, width, height);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

  let fillPath = '';
  if (fill) {
    const first = points[0];
    const last = points[points.length - 1];
    fillPath = `<path d="${pathD} L ${last[0].toFixed(1)} ${(y + height).toFixed(1)} L ${first[0].toFixed(
      1
    )} ${(y + height).toFixed(1)} Z" fill="${strokeColor}" opacity="0.12" />`;
  }

  return `${fillPath}<path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`;
}

function computeSummary(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => (Number.isFinite(c.high) ? c.high : c.close));
  const lows = candles.map((c) => (Number.isFinite(c.low) ? c.low : c.close));
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const min = rawMin === rawMax ? rawMin - 1 : rawMin;
  const max = rawMin === rawMax ? rawMax + 1 : rawMax;
  const last = closes[closes.length - 1];
  const first = closes[0];
  const changePct = ((last - first) / first) * 100;
  const direction = changePct >= 0 ? 'up' : 'down';
  return { min, max, last, first, changePct, direction, highVal: rawMax, lowVal: rawMin };
}

// Shared chrome: gradient backdrop, corner glow, vignette, header
// (logo/name/price/pct badge), time-axis ticks, and watermark. Returns the
// pieces the two style-specific body builders below stitch their plot
// content into (grid + hi/lo + series sit *between* background and header
// so the header's drop shadows composite over the plot, not under it).
function buildChrome({ coin, direction, preset, candles }) {
  const lineColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
  const badgeColor = direction === 'up' ? UP_BADGE : DOWN_BADGE;

  const plotX = PADDING.left + CHART_PAD;
  const plotY = PADDING.top;
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // Time-axis ticks: first, two evenly spaced middles, last — enough to
  // orient the eye without cluttering a 1080px-wide plot.
  const tickCount = 4;
  const timeLabels = [];
  for (let i = 0; i < tickCount; i += 1) {
    const idx = Math.round((i / (tickCount - 1)) * (candles.length - 1));
    const tx = plotX + (idx / Math.max(candles.length - 1, 1)) * plotWidth;
    const anchor = i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle';
    timeLabels.push(
      `<text x="${tx.toFixed(1)}" y="${(plotY + plotHeight + 42).toFixed(
        1
      )}" font-family="Poppins, sans-serif" font-size="21" fill="${AXIS_TEXT_COLOR}" text-anchor="${anchor}">${escapeXml(
        formatAxisTime(candles[idx].openTime, preset.timeFmt)
      )}</text>`
    );
    if (i > 0 && i < tickCount - 1) {
      timeLabels.push(
        `<line x1="${tx.toFixed(1)}" y1="${plotY}" x2="${tx.toFixed(1)}" y2="${(plotY + plotHeight).toFixed(
          1
        )}" stroke="${GRID_COLOR}" stroke-width="1" stroke-dasharray="3 6" />`
      );
    }
  }

  const defs = `
    ${FONT_FACES}
    <clipPath id="roundedCard">
      <rect x="0" y="0" width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" rx="30" />
    </clipPath>
    <linearGradient id="chartBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${shade(coin.color || '#3DDC84', 0.05)}" stop-opacity="0.55" />
      <stop offset="38%" stop-color="#12141C" />
      <stop offset="100%" stop-color="#040507" />
    </linearGradient>
    <radialGradient id="cornerGlow" cx="88%" cy="6%" r="60%">
      <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.20" />
      <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="38%" r="78%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.42" />
    </radialGradient>
    <linearGradient id="areaFill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.38" />
      <stop offset="65%" stop-color="${lineColor}" stop-opacity="0.08" />
      <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
    </linearGradient>
    <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.9" />
      <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
    </radialGradient>
    <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="7" />
    </filter>
    <filter id="pillShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.35" />
    </filter>
    <filter id="textShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.3" />
    </filter>
    <filter id="logoShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.4" />
    </filter>`;

  const background = `
    <rect x="0" y="0" width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" fill="url(#chartBgGrad)" />
    <rect x="0" y="0" width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" fill="url(#cornerGlow)" />`;

  const vignette = `<rect x="0" y="0" width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" fill="url(#vignette)" />`;

  const last = candles[candles.length - 1].close;
  const changePct = ((last - candles[0].close) / candles[0].close) * 100;
  const arrow = format.directionSymbol(direction);
  const pctStr = format.formatPct(changePct);
  const pctText = `${arrow} ${pctStr}`;
  const pctBadgeWidth = 46 + pctText.length * 16;
  const pctBadgeX = CHART_CANVAS_WIDTH - CHART_PAD - 60 - pctBadgeWidth;

  const header = `
    <circle cx="${LOGO_CX}" cy="${LOGO_CY + 30}" r="${LOGO_R}" fill="#FFFFFF" opacity="0.95" filter="url(#logoShadow)" />
    <text x="${LOGO_CX + LOGO_R + 26}" y="${LOGO_CY + 16}" font-family="Poppins, sans-serif" font-size="40" font-weight="700"
          fill="#FFFFFF" filter="url(#textShadow)">${escapeXml(coin.name)}</text>
    <text x="${LOGO_CX + LOGO_R + 26}" y="${LOGO_CY + 50}" font-family="Poppins, sans-serif" font-size="25" font-weight="400"
          fill="${AXIS_TEXT_COLOR}">${escapeXml(coin.symbol)} \u00B7 ${escapeXml(preset.label)}</text>

    <text x="${CHART_CANVAS_WIDTH - CHART_PAD - 60}" y="${LOGO_CY + 20}" font-family="Poppins, sans-serif" font-size="46" font-weight="700"
          fill="#FFFFFF" text-anchor="end" filter="url(#textShadow)">$${format.formatPrice(last)}</text>
    <rect x="${pctBadgeX}" y="${LOGO_CY + 36}" width="${pctBadgeWidth}" height="42" rx="21" fill="${badgeColor}" filter="url(#pillShadow)" />
    <text x="${pctBadgeX + pctBadgeWidth / 2}" y="${LOGO_CY + 64}" font-family="Poppins, sans-serif" font-size="24" font-weight="700"
          fill="#FFFFFF" text-anchor="middle">${escapeXml(pctText)}</text>
    <line x1="${60 + CHART_PAD}" y1="${LOGO_CY + 96}" x2="${CHART_CANVAS_WIDTH - CHART_PAD - 60}" y2="${LOGO_CY + 96}"
          stroke="${GRID_COLOR_STRONG}" stroke-width="1.5" />`;

  const footer = `
    <text x="${CHART_CANVAS_WIDTH - CHART_PAD - 40}" y="${CHART_HEIGHT - 32}" font-family="Poppins, sans-serif" font-size="26"
          font-weight="700" fill="#FFFFFF" text-anchor="end" opacity="0.9">@PricePing</text>
    <text x="${60 + CHART_PAD}" y="${CHART_HEIGHT - 32}" font-family="Poppins, sans-serif" font-size="19"
          fill="${AXIS_TEXT_COLOR}" text-anchor="start">Source: Binance</text>`;

  return { defs, background, vignette, header, footer, plotX, plotY, plotWidth, plotHeight, timeLabels, lineColor };
}

function buildPriceGrid(min, max, plotX, plotY, plotWidth, plotHeight) {
  const gridLines = [];
  const gridLabels = [];
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const value = min + ((max - min) * (steps - i)) / steps;
    const y = plotY + (plotHeight * i) / steps;
    gridLines.push(`<line x1="${plotX}" y1="${y.toFixed(1)}" x2="${plotX + plotWidth}" y2="${y.toFixed(
      1
    )}" stroke="${GRID_COLOR}" stroke-width="1" />`);
    gridLabels.push(
      `<text x="${plotX - 18}" y="${(y + 7).toFixed(1)}" font-family="Poppins, sans-serif" font-size="22" fill="${AXIS_TEXT_COLOR}" text-anchor="end">$${format.formatPrice(
        value
      )}</text>`
    );
  }
  return { gridLines, gridLabels };
}

// Faint dashed high/low reference lines + edge labels, so the day's range
// reads as context without competing with the main series.
function buildHiLoMarkers({ min, max, plotX, plotY, plotWidth, plotHeight, highVal, lowVal }) {
  const highY = scaleY(highVal, min, max, plotY, plotY + plotHeight);
  const lowY = scaleY(lowVal, min, max, plotY, plotY + plotHeight);
  return `
    <line x1="${plotX}" y1="${highY.toFixed(1)}" x2="${(plotX + plotWidth).toFixed(1)}" y2="${highY.toFixed(
    1
  )}" stroke="${AXIS_TEXT_COLOR}" stroke-width="1" stroke-dasharray="2 6" opacity="0.5" />
    <text x="${(plotX + plotWidth + 14).toFixed(1)}" y="${(highY + 6).toFixed(
    1
  )}" font-family="Poppins, sans-serif" font-size="17" fill="${AXIS_TEXT_COLOR}">HIGH</text>
    <line x1="${plotX}" y1="${lowY.toFixed(1)}" x2="${(plotX + plotWidth).toFixed(1)}" y2="${lowY.toFixed(
    1
  )}" stroke="${AXIS_TEXT_COLOR}" stroke-width="1" stroke-dasharray="2 6" opacity="0.5" />
    <text x="${(plotX + plotWidth + 14).toFixed(1)}" y="${(lowY + 6).toFixed(
    1
  )}" font-family="Poppins, sans-serif" font-size="17" fill="${AXIS_TEXT_COLOR}">LOW</text>`;
}

function renderLineBody({ candles, summary, chrome }) {
  const { min, max, highVal, lowVal } = summary;
  const { plotX, plotY, plotWidth, plotHeight, lineColor } = chrome;
  const { gridLines, gridLabels } = buildPriceGrid(min, max, plotX, plotY, plotWidth, plotHeight);
  const hiLo = buildHiLoMarkers({ min, max, plotX, plotY, plotWidth, plotHeight, highVal, lowVal });

  const points = computeLinePointsInRange(candles, min, max, plotX, plotY, plotWidth, plotHeight);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const areaFillPath = `<path d="${pathD} L ${last[0].toFixed(1)} ${(plotY + plotHeight).toFixed(1)} L ${first[0].toFixed(
    1
  )} ${(plotY + plotHeight).toFixed(1)} Z" fill="url(#areaFill)" />`;
  const glowLine = `<path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" />`;
  const mainLine = `<path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />`;
  const [dotX, dotY] = last;

  return `
    ${gridLines.join('\n    ')}
    ${gridLabels.join('\n    ')}
    ${chrome.timeLabels.join('\n    ')}
    ${hiLo}
    ${areaFillPath}
    <g opacity="0.55" filter="url(#lineGlow)">${glowLine}</g>
    ${mainLine}
    <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="18" fill="url(#dotGlow)" />
    <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="6.5" fill="${lineColor}" stroke="#0B0C10" stroke-width="2.5" />`;
}

function renderCandleBody({ candles, summary, chrome }) {
  const { min, max, highVal, lowVal } = summary;
  const { plotX, plotY, plotWidth, plotHeight } = chrome;
  const { gridLines, gridLabels } = buildPriceGrid(min, max, plotX, plotY, plotWidth, plotHeight);
  const hiLo = buildHiLoMarkers({ min, max, plotX, plotY, plotWidth, plotHeight, highVal, lowVal });

  const n = candles.length;
  const slot = plotWidth / n;
  const bodyWidth = Math.max(2, Math.min(22, slot * 0.62));

  const candleShapes = candles
    .map((c, i) => {
      const cx = plotX + slot * (i + 0.5);
      const hasOhlc = Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low);
      const open = hasOhlc ? c.open : c.close;
      const high = hasOhlc ? c.high : c.close;
      const low = hasOhlc ? c.low : c.close;
      const up = c.close >= open;
      const color = up ? UP_COLOR : DOWN_COLOR;
      const wickY1 = scaleY(high, min, max, plotY, plotY + plotHeight);
      const wickY2 = scaleY(low, min, max, plotY, plotY + plotHeight);
      const bodyTopVal = up ? c.close : open;
      const bodyBotVal = up ? open : c.close;
      let bodyY1 = scaleY(bodyTopVal, min, max, plotY, plotY + plotHeight);
      let bodyY2 = scaleY(bodyBotVal, min, max, plotY, plotY + plotHeight);
      if (bodyY2 - bodyY1 < 2) {
        // Doji / near-flat candle: keep a hairline-visible body instead of
        // collapsing to nothing.
        const mid = (bodyY1 + bodyY2) / 2;
        bodyY1 = mid - 1;
        bodyY2 = mid + 1;
      }
      return `
      <line x1="${cx.toFixed(1)}" y1="${wickY1.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${wickY2.toFixed(
        1
      )}" stroke="${color}" stroke-width="2.2" opacity="0.9" />
      <rect x="${(cx - bodyWidth / 2).toFixed(1)}" y="${bodyY1.toFixed(1)}" width="${bodyWidth.toFixed(
        1
      )}" height="${(bodyY2 - bodyY1).toFixed(1)}" rx="1.5" fill="${color}" />`;
    })
    .join('');

  return `
    ${gridLines.join('\n    ')}
    ${gridLabels.join('\n    ')}
    ${chrome.timeLabels.join('\n    ')}
    ${hiLo}
    <g filter="url(#lineGlow)" opacity="0.3">${candleShapes}</g>
    ${candleShapes}`;
}

async function compositeLogo(base, coin) {
  const logoPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  if (!fs.existsSync(logoPath)) return base;
  const size = Math.round(LOGO_R * 1.55 * SUPERSAMPLE);
  const cy = (LOGO_CY + 30) * SUPERSAMPLE;
  const cx = LOGO_CX * SUPERSAMPLE;
  const logoBuffer = await sharp(logoPath).resize(size, size, { fit: 'contain', kernel: 'lanczos3' }).toBuffer();
  return base.composite([
    {
      input: logoBuffer,
      left: Math.round(cx - size / 2),
      top: Math.round(cy - size / 2),
    },
  ]);
}

// Full standalone chart: gradient backdrop, gridlines, hi/lo markers, header
// with coin logo/name/price/pct badge, and watermark. Dispatches on `style`
// ('line' | 'candle') — candle style needs open/high/low on each candle
// (falls back gracefully to close-only data by flattening wicks to a dot).
// coin: entry from config.coins. candles: [{openTime, open?, high?, low?,
// close}] oldest->newest.
async function renderChart({ coin, candles, periodKey, style = 'line' }) {
  const preset = PERIOD_PRESETS[periodKey] || PERIOD_PRESETS['24h'];
  const styleKey = CHART_STYLES[style] ? style : 'line';
  const summary = computeSummary(candles);
  const chrome = buildChrome({ coin, direction: summary.direction, preset, candles });

  const body =
    styleKey === 'candle'
      ? renderCandleBody({ candles, summary, chrome })
      : renderLineBody({ candles, summary, chrome });

  const svg = `
<svg width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_CANVAS_WIDTH} ${CHART_HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>${chrome.defs}</defs>
  <g clip-path="url(#roundedCard)">
    ${chrome.background}
    ${body}
    ${chrome.header}
    ${chrome.footer}
    ${chrome.vignette}
  </g>
</svg>`;

  const base = sharp(Buffer.from(svg), { density: 72 * SUPERSAMPLE });
  const pipeline = await compositeLogo(base, coin);
  return pipeline
    .sharpen({ sigma: 0.6 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

module.exports = { renderChart, buildLinePath, PERIOD_PRESETS, CHART_STYLES };
