/**
 * Colour arithmetic for the design checks (PRD §2.11, §5 Visual design):
 * parsing the computed colour forms a browser returns, OKLCH and OKLab to
 * 8-bit sRGB with the published OKLab matrices [S177][S175], the WCAG 2
 * contrast ratio [S166], not rounded [S167], and APCA 0.0.98G-4g with the
 * constants of [S196]. tests/design-colour.test.ts proves it against DR-016's
 * hand-transcribed table before design.spec uses it to judge the page.
 */

export interface Rgba {
  /** 8-bit sRGB channels */
  r: number;
  g: number;
  b: number;
  /** 0 to 1 */
  a: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** OKLab (L 0 to 1) to 8-bit sRGB, rounded as DR-016 rounds its hex. */
export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bl].map((x) => Math.round(clamp01(linearToSrgb(x)) * 255)) as [number, number, number];
}

/** OKLCH (L 0 to 1, C, H in degrees) to 8-bit sRGB. */
export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  return oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
}

export function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** A number or percentage as the fraction of `full` it denotes. */
function num(token: string, full: number): number {
  if (token === 'none') return 0;
  return token.endsWith('%') ? (parseFloat(token) / 100) * full : parseFloat(token);
}

/**
 * Parses a computed colour: oklch() authored or minified (`99% .003`), oklab(),
 * rgb(), rgba(), color(srgb …) and `transparent`, with any alpha.
 */
export function parseColour(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = /^([a-z]+)\((.*)\)$/.exec(v);
  if (!m) return null;
  const [, fn, body] = m;
  const [main, alphaPart] = body.split('/').map((s) => s.trim());
  const parts = main.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  let alpha = alphaPart !== undefined ? num(alphaPart, 1) : 1;
  switch (fn) {
    case 'oklch': {
      const [r, g, b] = oklchToRgb(num(parts[0], 1), num(parts[1], 0.4), parseFloat(parts[2]) || 0);
      return { r, g, b, a: alpha };
    }
    case 'oklab': {
      const [r, g, b] = oklabToRgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4));
      return { r, g, b, a: alpha };
    }
    case 'rgb':
    case 'rgba': {
      if (alphaPart === undefined && parts.length === 4) alpha = num(parts[3], 1);
      const [r, g, b] = parts.slice(0, 3).map((p) => Math.round(num(p, 255)));
      return { r, g, b, a: alpha };
    }
    case 'color': {
      if (parts[0] !== 'srgb') return null;
      const [r, g, b] = parts.slice(1, 4).map((p) => Math.round(clamp01(num(p, 1)) * 255));
      return { r, g, b, a: alpha };
    }
    default:
      return null;
  }
}

/** Source-over composite of a translucent colour on an opaque one. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return {
    r: Math.round(top.r * a + under.r * (1 - a)),
    g: Math.round(top.g * a + under.g * (1 - a)),
    b: Math.round(top.b * a + under.b * (1 - a)),
    a: 1,
  };
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio, unrounded [S166][S167]. */
export function wcagRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** APCA 0.0.98G-4g lightness contrast, as a magnitude [S196]. */
export function apcaLc(text: [number, number, number], background: [number, number, number]): number {
  const y = ([r, g, b]: [number, number, number]) => {
    const v = 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
    return v > 0.022 ? v : v + (0.022 - v) ** 1.414;
  };
  const yt = y(text);
  const yb = y(background);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : Math.abs((s + 0.027) * 100);
}
