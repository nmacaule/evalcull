/**
 * Export rows source to JSONL (re-serialised).
 */

import type { RecordSource, CandidateRef, Decision } from '../types';
import { groupByLine, lineDecision } from '../store/refs';
import { losslessStringify } from '../lib/lossless';
import { parsePath, setByPath } from '../lib/path';

const YIELD_INTERVAL = 5000;

/**
 * Export rows source to JSONL.
 * All rows are re-serialised with lossless-json.
 *
 * @param src Rows source
 * @param decisions Map of decisions keyed by CandidateRef
 * @param include Filter function: return true to include row i
 * @param onProgress Optional progress callback
 */
export async function exportRows(
  src: Extract<RecordSource, { kind: 'rows' }>,
  decisions: Map<CandidateRef, Decision>,
  include: (i: number, d?: Decision) => boolean,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const parts: string[] = [];
  const byLineIndex = groupByLine(decisions);

  for (let i = 0; i < src.count; i++) {
    const d = lineDecision(decisions, byLineIndex, i);

    if (!include(i, d)) continue;

    let row = await src.readRow(i);

    // Apply edits if any
    if (d?.edits && Object.keys(d.edits).length) {
      for (const [path, value] of Object.entries(d.edits)) {
        const segments = parsePath(path);
        row = setByPath(row, segments, value);
      }
    }

    parts.push(losslessStringify(row) + '\n');

    // Yield to allow page paint
    if (i % YIELD_INTERVAL === 0) {
      await new Promise((r) => setTimeout(r, 0));
      if (onProgress) {
        onProgress(i, src.count);
      }
    }
  }

  if (onProgress) {
    onProgress(src.count, src.count);
  }

  return new Blob(parts, { type: 'application/jsonl' });
}
