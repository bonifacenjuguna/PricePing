// Standalone chart renderer: line and candlestick styles, sharing one
// "chrome" builder (background, gridlines, header, watermark) so the two
// style-specific body functions only need to draw the plot content itself.
// Same SVG -> sharp 3x-supersample -> composite -> sharpen pipeline as
// cardRenderer.js. buildLinePath is also re-exported/reused by
// cardRenderer.js for the loose-mode sparkline.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const format = require('../lib/format');
const { shade } = require('../lib/colors');
const { FONT_FACES, escapeXml } = require('../lib/fonts');

const SUPERSAMPLE = config.SUPERSAMPLE;
const CHART_WIDTH = 1080;
const CHART_HEIGHT = 640;
const PADDING = { top: 170, right: 60, bottom: 90, left: 100 };
const LOGO_R = 40;

const GRID_COLOR = 'rgba(255,255,255,0.10)';
const AXIS_TEXT_COLOR = 'rgba(255,255,255,0.55)';
const UP_COLOR = '#3DDC84';
const DOWN_COLOR = '#FF5C5C';

// Period presets: interval string for Binance, minutes for Kraken.
const PERIOD_PRESETS = {
  '1h': { binanceInterval: '1m', krakenMinutes: 1, limit: 60, label: 'Last 1 hour', timeFmt: 'time' },
  '24h': { binanceInterval: '15m', krakenMinutes: 15, limit: 96, label: 'Last 24 hours', timeFmt: 'time' },
  '7d': { binanceInterval: '2h', krakenMinutes: 120, limit: 84, label: 'Last 7 days', timeFmt: 'date' },
  '30d': { binanceInterval: '6h', krakenMinutes: 360, limit: 120, label: 'Last 30 days', timeFmt: 'date' },
};

const CHART_STYLES = {
  line: { key: 'line', label: '📈 Line' },
  candle: { key: 'candle', label: '🕯️ Candles' },
};

function scaleY(value, min, max, top, bottom) {
  if (max === min) return (top + bottom) / 2;
  return bottom - ((value - min) / (max - min)) * (bottom - top);
}

function formatAxisTime(ms, timeFmt) {
  const d = new Date(ms);
  if (timeFmt === 'date') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function computeLinePointsInRange(candles, min, max, x, y, width, height) {
  return candles.map((c, i) => {
    const px = x + (i / Math.max(candles.length - 1, 1)) * width;
    const py = scaleY(c.close, min, max, y, y + height);
    return [px, py];
  });
}

// Shared with cardRenderer.js's sparkline — small standalone line, no axes.
function buildLinePath(candles, { x, y, width, height, strokeColor, strokeWidth = 3, fill = false }) {
  if (!candles.length) return '';
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const points = computeLinePointsInRange(candles, min, max, x, y, width, height);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  let fillPath = '';
  if (fill) {
    const first = points[0];
    const last = points[points.length - 1];
    fillPath = `<path d="${pathD} L ${last[0].toFixed(1)} ${(y + height).toFixed(1)} L ${first[0].toFixed(1)} ${(y + height).toFixed(1)} Z" fill="${strokeColor}" opacity="0.12" />`;
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
  return { min, max, last, first, changePct, direction: changePct >= 0 ? 'up' : 'down', highVal: rawMax, lowVal: rawMin };
}

function buildChrome({ coin, direction, preset, candles, source }) {
  const lineColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
  const plotX = PADDING.left;
  const plotY = PADDING.top;
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const tickCount = 4;
  const timeLabels = [];
  for (let i = 0; i < tickCount; i += 1) {
    const idx = Math.round((i / (tickCount - 1)) * (candles.length - 1));
    const tx = plotX + (idx / Math.max(candles.length - 1, 1)) * plotWidth;
    const anchor = i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle';
    timeLabels.push(`<text x="${tx.toFixed(1)}" y="${(plotY + plotHeight + 42).toFixed(1)}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="20" fill="${AXIS_TEXT_COLOR}" text-anchor="${anchor}">${escapeXml(formatAxisTime(candles[idx].openTime, preset.timeFmt))}</text>`);
  }

  const defs = `
    ${FONT_FACES()}
    <clipPath id="roundedCard"><rect x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" rx="28" /></clipPath>
    <linearGradient id="chartBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${shade(coin.color || '#3DDC84', 0.05)}" stop-opacity="0.5" />
      <stop offset="40%" stop-color="#12141C" />
      <stop offset="100%" stop-color="#040507" />
    </linearGradient>
    <radialGradient id="cornerGlow" cx="88%" cy="6%" r="60%">
      <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.18" /><stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
    </radialGradient>`;

  const priceStr = `$${format.formatPrice(computeSummary(candles).last)}`;
  const pctStr = format.formatPct(computeSummary(candles).changePct);
  const badgeColor = direction === 'up' ? UP_COLOR : DOWN_COLOR;
  const header = `
    <text x="${plotX}" y="66" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="42" font-weight="700" fill="#FFFFFF">${escapeXml(coin.name)}</text>
    <text x="${plotX}" y="102" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="26" fill="rgba(255,255,255,0.6)">${escapeXml(preset.label)}</text>
    <text x="${CHART_WIDTH - 60}" y="66" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="42" font-weight="700" fill="#FFFFFF" text-anchor="end">${escapeXml(priceStr)}</text>
    <rect x="${CHART_WIDTH - 60 - (44 + pctStr.length * 15)}" y="80" width="${44 + pctStr.length * 15}" height="46" rx="23" fill="${badgeColor}" />
    <text x="${CHART_WIDTH - 60 - (44 + pctStr.length * 15) / 2}" y="111" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="24" font-weight="700" fill="#FFFFFF" text-anchor="middle">${escapeXml(pctStr)}</text>`;

  const footer = `<text x="${CHART_WIDTH - 40}" y="${CHART_HEIGHT - 30}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="22" fill="rgba(255,255,255,0.5)" text-anchor="end">via ${escapeXml(source || 'live')}</text>`;
  const background = `<rect x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="url(#chartBgGrad)" /><rect x="0" y="0" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="url(#cornerGlow)" />`;

  return { defs, background, header, footer, plotX, plotY, plotWidth, plotHeight, timeLabels, lineColor };
}

function buildPriceGrid(min, max, plotX, plotY, plotWidth, plotHeight) {
  const gridLines = [];
  const gridLabels = [];
  for (let i = 0; i <= 4; i += 1) {
    const value = min + ((max - min) * (4 - i)) / 4;
    const y = plotY + (plotHeight * i) / 4;
    gridLines.push(`<line x1="${plotX}" y1="${y.toFixed(1)}" x2="${plotX + plotWidth}" y2="${y.toFixed(1)}" stroke="${GRID_COLOR}" stroke-width="1" />`);
    gridLabels.push(`<text x="${plotX - 16}" y="${(y + 7).toFixed(1)}" font-family="Inter, 'DejaVu Sans', sans-serif" font-size="20" fill="${AXIS_TEXT_COLOR}" text-anchor="end">$${format.formatPrice(value)}</text>`);
  }
  return { gridLines, gridLabels };
}

function renderLineBody({ candles, summary, chrome }) {
  const { min, max } = summary;
  const { plotX, plotY, plotWidth, plotHeight, lineColor } = chrome;
  const { gridLines, gridLabels } = buildPriceGrid(min, max, plotX, plotY, plotWidth, plotHeight);
  const points = computeLinePointsInRange(candles, min, max, plotX, plotY, plotWidth, plotHeight);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const [dotX, dotY] = points[points.length - 1];
  return `
    ${gridLines.join('')}${gridLabels.join('')}${chrome.timeLabels.join('')}
    <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="10" opacity="0.25" stroke-linejoin="round" stroke-linecap="round" />
    <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="7" fill="${lineColor}" stroke="#0B0C10" stroke-width="2.5" />`;
}

function renderCandleBody({ candles, summary, chrome }) {
  const { min, max } = summary;
  const { plotX, plotY, plotWidth, plotHeight } = chrome;
  const { gridLines, gridLabels } = buildPriceGrid(min, max, plotX, plotY, plotWidth, plotHeight);
  const n = candles.length;
  const slot = plotWidth / n;
  const bodyWidth = Math.max(2, Math.min(20, slot * 0.6));
  const shapes = candles.map((c, i) => {
    const cx = plotX + slot * (i + 0.5);
    const up = c.close >= c.open;
    const color = up ? UP_COLOR : DOWN_COLOR;
    const wickY1 = scaleY(c.high, min, max, plotY, plotY + plotHeight);
    const wickY2 = scaleY(c.low, min, max, plotY, plotY + plotHeight);
    let bodyY1 = scaleY(up ? c.close : c.open, min, max, plotY, plotY + plotHeight);
    let bodyY2 = scaleY(up ? c.open : c.close, min, max, plotY, plotY + plotHeight);
    if (bodyY2 - bodyY1 < 2) { const mid = (bodyY1 + bodyY2) / 2; bodyY1 = mid - 1; bodyY2 = mid + 1; }
    return `<line x1="${cx.toFixed(1)}" y1="${wickY1.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${wickY2.toFixed(1)}" stroke="${color}" stroke-width="2" />
      <rect x="${(cx - bodyWidth / 2).toFixed(1)}" y="${bodyY1.toFixed(1)}" width="${bodyWidth.toFixed(1)}" height="${(bodyY2 - bodyY1).toFixed(1)}" rx="1.5" fill="${color}" />`;
  }).join('');
  return `${gridLines.join('')}${gridLabels.join('')}${chrome.timeLabels.join('')}${shapes}`;
}

async function compositeLogo(base, coin) {
  const logoPath = path.join(config.logosDir, `${coin.symbol.toLowerCase()}.png`);
  if (!fs.existsSync(logoPath)) return base;
  const size = Math.round(LOGO_R * 1.5 * SUPERSAMPLE);
  const cx = 60 * SUPERSAMPLE + size / 2 - 10;
  const cy = 130 * SUPERSAMPLE;
  const logoBuffer = await sharp(logoPath).resize(size, size, { fit: 'contain', kernel: 'lanczos3' }).toBuffer();
  return base.composite([{ input: logoBuffer, left: Math.round(cx - size / 2), top: Math.round(cy - size / 2) }]);
}

// coin: from coins.js. candles: [{openTime, open, high, low, close}] oldest->newest.
async function renderChart({ coin, candles, periodKey, style = 'line', source }) {
  const preset = PERIOD_PRESETS[periodKey] || PERIOD_PRESETS['24h'];
  const styleKey = CHART_STYLES[style] ? style : 'line';
  const summary = computeSummary(candles);
  const chrome = buildChrome({ coin, direction: summary.direction, preset, candles, source });
  const body = styleKey === 'candle' ? renderCandleBody({ candles, summary, chrome }) : renderLineBody({ candles, summary, chrome });

  const svg = `
<svg width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>${chrome.defs}</defs>
  <g clip-path="url(#roundedCard)">${chrome.background}${body}${chrome.header}${chrome.footer}</g>
</svg>`;

  const base = sharp(Buffer.from(svg), { density: 72 * SUPERSAMPLE });
  const pipeline = await compositeLogo(base, coin);
  return pipeline.sharpen({ sigma: 0.6 }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

module.exports = { renderChart, buildLinePath, PERIOD_PRESETS, CHART_STYLES, CHART_WIDTH, CHART_HEIGHT };
