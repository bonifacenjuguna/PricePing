const fs = require('fs');
const path = require('path');
const config = require('../config');

// Poppins (Bold + Regular), SIL Open Font License 1.1 — see
// src/assets/fonts/OFL.txt. Embedded as base64 data URIs directly in every
// SVG we render via @font-face so rendering never depends on whatever fonts
// happen to be installed on the Railway image. Read once at module load and
// cached — never re-read per render. Shared by cardRenderer.js and
// chartRenderer.js so it's only loaded into memory once, not twice.
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

module.exports = { FONT_FACES, escapeXml };
