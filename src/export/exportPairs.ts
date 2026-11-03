/**
 * Export pairs array to JSONL blob.
 */

import type { TrlPair } from '../lib/pairs';
import { losslessStringify } from '../lib/lossless';

/**
 * Serialise pairs array to JSONL blob using lossless-json.
 */
export function exportPairsJsonl(pairs: TrlPair[]): Blob {
  const parts: string[] = [];

  for (const pair of pairs) {
    parts.push(losslessStringify(pair) + '\n');
  }

  return new Blob(parts, { type: 'application/jsonl' });
}
