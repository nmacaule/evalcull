/**
 * Fields for the metadata panel (PRD §2.8): every top-level field of a record
 * that the format does not map to the cards, with its display text and
 * whether it holds an integer outside the safe range (PRD §2.4, badged).
 */

import { isLosslessNumber } from 'lossless-json';
import type { RecordFormat } from '../types';
import { parsePath } from './path';
import { displayValue } from './display';

export interface MetadataField {
  key: string;
  text: string;
  unsafeInteger: boolean;
}

const MAX_SAFE_DIGITS = String(Number.MAX_SAFE_INTEGER); // 9007199254740991

function mappedPaths(format: RecordFormat): string[] {
  switch (format.kind) {
    case 'flat':
      return [format.promptPath, format.responsePath];
    case 'messages':
      return [format.path];
    case 'preference':
      return [format.promptPath, format.chosenPath, format.rejectedPath].filter(
        (p): p is string => !!p
      );
    case 'candidates':
      return [format.promptPath, format.candidatesPath];
    default:
      return [];
  }
}

function firstMember(path: string): string | null {
  try {
    const seg = parsePath(path)[0];
    return seg && seg.type === 'member' ? seg.key : null;
  } catch {
    return null;
  }
}

// Whether a number's magnitude, read from its digits as written, is above
// 9007199254740991: the exponent moves the decimal point, the integer part is
// compared digit by digit, and equal with any nonzero fraction counts as above.
// Never a parsed number, which would round first (D-051, D-054)
function aboveSafeRange(text: string): boolean {
  const m = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) return false;
  const all = m[1] + (m[2] ?? '');
  const lead = /^0*/.exec(all)![0].length;
  const digits = all.slice(lead);
  if (digits === '') return false;
  // Digits before the decimal point once the exponent is applied
  const point = m[1].length + Number(m[3] ?? '0') - lead;
  if (point !== MAX_SAFE_DIGITS.length) return point > MAX_SAFE_DIGITS.length;
  const integer = digits.slice(0, point).padEnd(point, '0');
  if (integer !== MAX_SAFE_DIGITS) return integer > MAX_SAFE_DIGITS;
  return /[1-9]/.test(digits.slice(point));
}

function hasUnsafeInteger(value: unknown): boolean {
  if (isLosslessNumber(value)) return aboveSafeRange(value.value);
  if (Array.isArray(value)) return value.some(hasUnsafeInteger);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasUnsafeInteger);
  }
  return false;
}

export function unmappedFields(data: unknown, format: RecordFormat): MetadataField[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [];
  const mapped = new Set(mappedPaths(format).map(firstMember).filter((k): k is string => k !== null));
  return Object.entries(data as Record<string, unknown>)
    .filter(([key]) => !mapped.has(key))
    .map(([key, value]) => ({ key, text: displayValue(value), unsafeInteger: hasUnsafeInteger(value) }));
}
