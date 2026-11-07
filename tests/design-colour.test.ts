// @vitest-environment node
/**
 * Proves e2e/design/colour.ts against DR-016's hand-computed table before the
 * design spec uses it to judge the page (PRD §2.11, §5 Visual design). The
 * oracle is the record's own figures, computed on 6 Nov 2026 by an independent
 * inline script.
 */

import { describe, it, expect } from 'vitest';
import { apcaLc, hexToRgb, oklchToRgb, parseColour, toHex, wcagRatio } from '../e2e/design/colour';
import { ADDED_ROWS, DR016_ROWS, ON_PRIMARY, TOKENS, type Theme } from '../e2e/design/tokens';

function hexOf(name: string, theme: Theme): string {
  if (name === 'white') return ON_PRIMARY.hex;
  return TOKENS[name][theme].hex;
}

describe('design colour arithmetic', () => {
  it('converts every §2.11 token from oklch to its PRD hex, in both themes', () => {
    for (const [name, themes] of Object.entries(TOKENS)) {
      for (const theme of ['light', 'dark'] as const) {
        const t = themes[theme];
        expect(toHex(oklchToRgb(t.l, t.c, t.h)), `${theme} ${name}`).toBe(t.hex);
      }
    }
  });

  it("reproduces each of DR-016's contrast rows: ratio to 2 decimals, Lc to 1", () => {
    expect(DR016_ROWS).toHaveLength(78);
    for (const row of [...DR016_ROWS, ...ADDED_ROWS]) {
      const fg = hexToRgb(hexOf(row.fg, row.theme));
      const bg = hexToRgb(hexOf(row.bg, row.theme));
      const label = `${row.theme} ${row.fg} on ${row.bg}`;
      expect(wcagRatio(fg, bg).toFixed(2), label).toBe(row.ratio.toFixed(2));
      expect(apcaLc(fg, bg).toFixed(1), label).toBe(row.lc.toFixed(1));
    }
  });

  it('parses the authored and the minified oklch forms to the same colour', () => {
    expect(parseColour('oklch(0.99 0.003 280)')).toEqual(parseColour('oklch(99% .003 280)'));
    expect(toHex([...Object.values(parseColour('oklch(99% .003 280)')!).slice(0, 3)] as [number, number, number])).toBe('#FBFCFE');
  });

  it("parses the forms Chromium's getComputedStyle returned on 6 Nov 2026", () => {
    // Recorded from the first design.spec run on the built single file (Playwright's Chromium)
    expect(parseColour('oklch(0.985 0 0)')).toEqual({ r: 250, g: 250, b: 250, a: 1 });
    expect(parseColour('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColour('oklab(0 0 0 / 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColour('rgb(0, 95, 204)')).toEqual({ r: 0, g: 95, b: 204, a: 1 });
  });

  it('parses transparent, rgba and color(srgb) with their alpha', () => {
    expect(parseColour('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColour('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColour('rgb(255 255 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('color(srgb 1 1 1 / 0.4)')).toEqual({ r: 255, g: 255, b: 255, a: 0.4 });
    expect(parseColour('oklab(0 0 0 / 0.4)')).toEqual({ r: 0, g: 0, b: 0, a: 0.4 });
  });
});
