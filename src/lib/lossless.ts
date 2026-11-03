/**
 * Shared lossless-json helper with onDuplicateKey: last-wins.
 * Single configuration point for the edit path and display.
 */

import { parse } from 'lossless-json';
export { stringify as losslessStringify } from 'lossless-json';

/**
 * Parse JSON text with lossless-json.
 * Preserves big integers and number formatting (1.0, 1e3, -0).
 * Duplicate keys resolve to last value (matches JavaScript behaviour).
 */
export function losslessParse(text: string): unknown {
  return parse(text, undefined, { onDuplicateKey: ({ newValue }) => newValue });
}
