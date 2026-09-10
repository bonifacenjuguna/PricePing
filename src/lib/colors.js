// Small color helpers for the SVG card/chart templates.

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// amount: -1 (fully black) to +1 (fully white). 0 = unchanged.
function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const target = amount >= 0 ? 255 : 0;
  const factor = Math.abs(amount);
  return rgbToHex({
    r: r + (target - r) * factor,
    g: g + (target - g) * factor,
    b: b + (target - b) * factor,
  });
}

// Picks white or near-black text depending on background luminance (WCAG-ish
// relative luminance approximation) — keeps text readable on any brand color.
function contrastTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1A1A1A' : '#FFFFFF';
}

module.exports = { hexToRgb, rgbToHex, shade, contrastTextColor };
