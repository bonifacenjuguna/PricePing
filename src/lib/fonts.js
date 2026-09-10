const fs = require('fs');
const path = require('path');
const config = require('../config');

// Embeds fonts as base64 data URIs directly in the SVG's @font-face rule —
// sharp's SVG renderer has no access to system-installed fonts on Railway,
// so the font has to travel WITH the SVG document itself.
function loadFontFaces() {
  const files = [
    { file: 'Inter-Regular.ttf', family: 'Inter', weight: 400 },
    { file: 'Inter-Bold.ttf', family: 'Inter', weight: 700 },
  ];
  const faces = files
    .map(({ file, family, weight }) => {
      const fp = path.join(config.fontsDir, file);
      if (!fs.existsSync(fp)) return '';
      const b64 = fs.readFileSync(fp).toString('base64');
      return `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url(data:font/ttf;base64,${b64}) format('truetype'); }`;
    })
    .filter(Boolean)
    .join('\n');
  return `<style>${faces}</style>`;
}

let cached = null;
function FONT_FACES() {
  if (!cached) cached = loadFontFaces();
  return cached;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { FONT_FACES, escapeXml };
