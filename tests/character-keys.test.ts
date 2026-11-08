// @vitest-environment node
/**
 * Which HOTKEY_TABLE keys the single-key switch turns off (WP 7d, DR-029, WCAG 2.2 SC 2.1.4).
 * Oracle: the two lists below, written by hand from the SC's definition (a shortcut that
 * relies on a printable character) and the table's own key strings.
 */

import { describe, it, expect } from 'vitest';
import { HOTKEY_TABLE, isCharacterKey } from '../src/lib/hotkeyTable';

const NOT_CHARACTER = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'mod+enter'];

const CHARACTER = [
  '1', '2', '=', '0', 'x', 'Shift+1', 'Shift+2', 'Shift+3', 'a', 'r', 's', 'j', 'k',
  'e', 'u', 'Shift+u', 't', 'w', 'z', 'f', '?', 'm', 'l', 'n', 'g', '/',
];

describe('isCharacterKey over HOTKEY_TABLE (DR-029)', () => {
  const every = HOTKEY_TABLE.flatMap((h) => (h.altKey ? [h.key, h.altKey] : [h.key]));

  it('the table holds exactly these 33 key strings', () => {
    expect([...every].sort()).toEqual([...NOT_CHARACTER, ...CHARACTER].sort());
  });

  it('is false for exactly the arrows, Tab, Esc and Mod+Enter, and true for the 26 character keys', () => {
    expect(every.filter((k) => !isCharacterKey(k)).sort()).toEqual([...NOT_CHARACTER].sort());
    expect(every.filter((k) => isCharacterKey(k)).sort()).toEqual([...CHARACTER].sort());
    expect(CHARACTER).toHaveLength(26);
  });
});
