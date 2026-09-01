const sharp = require('sharp');
const format = require('../utils/format');
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
const PADDING = { top: 130, right: 60, bottom: 70, left: 90 };
// See SUPERSAMPLE in cardRenderer.js — same reasoning applies here: render
// at 3x via SVG density (layout coordinates untouched), so the thin grid
// lines and sparkline curve survive Telegram's JPEG re-encode cleanly
// instead of turning fuzzy.
const SUPERSAMPLE = 3;

const GRID_COLOR = 'rgba(255,255,255,0.14)';
const AXIS_TEXT_COLOR = 'rgba(255,255,255,0.65)';

// Period presets for /chart SYMBOL [period]. interval/limit chosen so each
// preset stays well under a few hundred candles — plenty of resolution for
// a 1080px-wide chart without over-fetching Binance.
const PERIOD_PRESETS = {
  '1h': { interval: '1m', limit: 60, label: 'Last 1 hour' },
  '24h': { interval: '15m', limit: 96, label: 'Last 24 hours' },
  '7d': { interval: '2h', limit: 84, label: 'Last 7 days' },
  '30d': { interval: '6h', limit: 120, label: 'Last 30 days' },
};

function scaleY(value, min, max, top, bottom) {
  if (max === min) return (top + bottom) / 2;
  return bottom - ((value - min) / (max - min)) * (bottom - top);
}

// Builds just the <polyline>/<path> + optional fill for a price series,
// scaled into an arbitrary box. Used both for the full /chart render below
// and embedded at small size inside the manual-post rich card
// (cardRenderer.js) as a sparkline — hence no axes/labels/fonts here, just
// the line geometry, so it composes cleanly inside another SVG.
function buildLinePath(candles, { x, y, width, height, strokeColor, strokeWidth = 3, fill = false }) {
  if (!candles.length) return '';
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);

  const points = candles.map((c, i) => {
    const px = x + (i / Math.max(candles.length - 1, 1)) * width;
    const py = scaleY(c.close, min, max, y, y + height);
    return [px, py];
  });

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

// Full standalone chart: gridlines, min/max price labels, title, watermark.
// coin: entry from config.coins. candles: [{openTime, close}] oldest->newest.
async function renderChart({ coin, candles, periodKey }) {
  const preset = PERIOD_PRESETS[periodKey] || PERIOD_PRESETS['24h'];
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.min(...closes) === Math.max(...closes) ? Math.max(...closes) + 1 : Math.max(...closes);
  const last = closes[closes.length - 1];
  const first = closes[0];
  const changePct = ((last - first) / first) * 100;
  const direction = changePct >= 0 ? 'up' : 'down';
  const lineColor = direction === 'up' ? '#3DDC84' : '#FF5C5C';

  const plotX = PADDING.left + CHART_PAD;
  const plotY = PADDING.top;
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // Horizontal gridlines at 4 evenly spaced price levels.
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
      `<text x="${plotX - 16}" y="${(y + 6).toFixed(1)}" font-family="Poppins, sans-serif" font-size="22" fill="${AXIS_TEXT_COLOR}" text-anchor="end">$${format.formatPrice(
        value
      )}</text>`
    );
  }

  const linePath = buildLinePath(candles, {
    x: plotX,
    y: plotY,
    width: plotWidth,
    height: plotHeight,
    strokeColor: lineColor,
    strokeWidth: 4,
    fill: true,
  });

  const arrow = format.directionSymbol(direction);
  const pctStr = format.formatPct(changePct);
  const pctText = `${arrow} ${pctStr}`;
  const pctBadgeWidth = 46 + pctText.length * 16;
  const pctBadgeX = CHART_CANVAS_WIDTH - CHART_PAD - 60 - pctBadgeWidth;
  const badgeColor = direction === 'up' ? '#1F8A4C' : '#C62828';

  const svg = `
<svg width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_CANVAS_WIDTH} ${CHART_HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${FONT_FACES}
    <clipPath id="roundedCard">
      <rect x="0" y="0" width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" rx="28" />
    </clipPath>
  </defs>
  <g clip-path="url(#roundedCard)">
    <rect x="0" y="0" width="${CHART_CANVAS_WIDTH}" height="${CHART_HEIGHT}" fill="#0E1116" />

    <text x="${60 + CHART_PAD}" y="60" font-family="Poppins, sans-serif" font-size="42" font-weight="700" fill="#FFFFFF">${escapeXml(
    coin.name
  )} (${escapeXml(coin.symbol)})</text>
    <text x="${60 + CHART_PAD}" y="98" font-family="Poppins, sans-serif" font-size="26" font-weight="400" fill="${AXIS_TEXT_COLOR}">${escapeXml(
    preset.label
  )}</text>

    <text x="${CHART_CANVAS_WIDTH - CHART_PAD - 60}" y="60" font-family="Poppins, sans-serif" font-size="42" font-weight="700"
          fill="#FFFFFF" text-anchor="end">$${format.formatPrice(last)}</text>
    <rect x="${pctBadgeX}" y="76" width="${pctBadgeWidth}" height="40" rx="20" fill="${badgeColor}" />
    <text x="${pctBadgeX + pctBadgeWidth / 2}" y="103" font-family="Poppins, sans-serif" font-size="24" font-weight="700"
          fill="#FFFFFF" text-anchor="middle">${escapeXml(pctText)}</text>

    ${gridLines.join('\n    ')}
    ${gridLabels.join('\n    ')}
    ${linePath}

    <text x="${CHART_CANVAS_WIDTH - CHART_PAD - 40}" y="${CHART_HEIGHT - 30}" font-family="Poppins, sans-serif" font-size="26"
          font-weight="700" fill="#FFFFFF" text-anchor="end" opacity="0.85">@PricePing</text>
  </g>
</svg>`;

  return sharp(Buffer.from(svg), { density: 72 * SUPERSAMPLE })
    .sharpen({ sigma: 0.6 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

module.exports = { renderChart, buildLinePath, PERIOD_PRESETS };
