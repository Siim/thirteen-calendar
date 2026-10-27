// Colour maths for the design token scripts. No dependencies.
//
// Token colour values are strings:
//   "#rrggbb"          an opaque sRGB colour
//   "#rrggbb / 0.12"   the same colour at 12% opacity (mirrors CSS `rgb(r g b / a)`)
//   "{role}"           a reference to another role of the same theme and mode

const HEX = /^#([0-9a-f]{6})$/;
const HEX_ALPHA = /^#([0-9a-f]{6})\s*\/\s*(0(?:\.\d+)?|1(?:\.0+)?)$/;
const REF = /^\{([a-z0-9-]+)\}$/;

/** `{ role }` when the value is a "{role}" reference, otherwise null. */
export function parseRef(value) {
  const match = REF.exec(value);
  return match ? { role: match[1] } : null;
}

/** Parses "#rrggbb" or "#rrggbb / a" into { hex, r, g, b, alpha } (channels 0..255, alpha 0..1). */
export function parseColor(value) {
  if (typeof value !== 'string') throw new Error(`Colour must be a string, got ${JSON.stringify(value)}`);
  const v = value.trim();
  let match = HEX.exec(v);
  let alpha = 1;
  if (!match) {
    match = HEX_ALPHA.exec(v);
    if (!match) throw new Error(`Not a "#rrggbb" or "#rrggbb / alpha" colour (lowercase hex): ${JSON.stringify(value)}`);
    alpha = Number(match[2]);
  }
  const hex = `#${match[1]}`;
  const n = Number.parseInt(match[1], 16);
  return { hex, r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, alpha };
}

/** Source-over composite of a (possibly translucent) colour onto an opaque background. */
export function composite(fg, bg) {
  if (fg.alpha >= 1) return fg;
  const mix = (f, b) => Math.round(f * fg.alpha + b * (1 - fg.alpha));
  const r = mix(fg.r, bg.r);
  const g = mix(fg.g, bg.g);
  const b = mix(fg.b, bg.b);
  return { hex: toHex(r, g, b), r, g, b, alpha: 1 };
}

export function toHex(r, g, b) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const linear = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.2 relative luminance. */
export function luminance(color) {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG 2.2 contrast ratio of a foreground on an opaque background (translucent foregrounds are composited first). */
export function contrast(fg, bg) {
  const a = luminance(composite(fg, bg));
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** OKLab (L 0..1, a/b roughly -0.4..0.4) of an opaque colour. */
export function oklab(color) {
  const r = linear(color.r);
  const g = linear(color.g);
  const b = linear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Perceptual distance between two opaque colours: Euclidean distance in OKLab (0.02 is about one just-noticeable step). */
export function deltaEOK(x, y) {
  const p = oklab(x);
  const q = oklab(y);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** Hue angle in degrees in OKLCH, or null for near-neutral colours. */
export function hueOK(color) {
  const { a, b } = oklab(color);
  if (Math.hypot(a, b) < 0.02) return null;
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}
