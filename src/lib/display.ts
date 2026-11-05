/**
 * Display text for a value read from a record (D-015). Strings are shown as
 * they are; anything else through lossless-json, so 9007199254740993 and 1.0
 * display as written (PRD §2.4: one parser for display and the edit path).
 */

import { losslessStringify } from './lossless';

export function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  // A null field reads null, as written; only a missing value is empty (D-030)
  if (value === undefined) return '';
  return losslessStringify(value) ?? '';
}
