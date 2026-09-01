// Relative luminance (WCAG-ish) to decide whether white or near-black text
// reads better on a given brand color background.
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Returns '#FFFFFF' or a near-black, whichever contrasts better against
// the given brand color background.
function contrastTextColor(hex) {
  const luminance = relativeLuminance(hexToRgb(hex));
  return luminance > 0.5 ? '#1A1A1A' : '#FFFFFF';
}

// Slightly darkened variant of a hex color, used for subtitle text so it
// reads as secondary against the primary text color on the same background.
function mutedVariant(hex, textColor) {
  return textColor === '#FFFFFF' ? 'rgba(255,255,255,0.72)' : 'rgba(26,26,26,0.65)';
}

// Blends a hex color toward white (amt > 0) or black (amt < 0). amt is
// 0..1. Used for the card background gradient — a same-hue lighter/darker
// pair reads as "premium depth" without introducing a second brand color.
function clamp(v) {
  return Math.max(0, Math.min(255, v));
}

function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const target = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const blend = (c) => Math.round(clamp(c + (target - c) * p));
  const toHex = (c) => c.toString(16).padStart(2, '0');
  return `#${toHex(blend(r))}${toHex(blend(g))}${toHex(blend(b))}`;
}

module.exports = { hexToRgb, relativeLuminance, contrastTextColor, mutedVariant, shade };
