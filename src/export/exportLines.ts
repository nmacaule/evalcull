/**
 * Byte-exact JSONL export per §3.6.
 *
 * For unedited lines: copies raw bytes including terminator.
 * For edited lines: parses with lossless-json, applies edits, re-serialises.
 *
 * Deviation from §3.6: idx is accessed via src.index instead of separate parameter.
 */

import type { RecordSource, CandidateRef, Decision } from '../types';
import { groupByLine, lineDecision } from '../store/refs';
import { losslessParse, losslessStringify } from '../lib/lossless';
import { parsePath, setByPath } from '../lib/path';

/**
 * Export JSONL source with byte-exact passthrough for unedited lines.
 *
 * @param src JSONL source with index
 * @param decisions Map of decisions keyed by CandidateRef
 * @param include Filter function: return true to include line i
 * @param opts BOM handling option (default: 'keep')
 * @param onProgress Optional progress callback
 */
export async function exportLines(
  src: Extract<RecordSource, { kind: 'jsonl' }>,
  decisions: Map<CandidateRef, Decision>,
  include: (i: number, d?: Decision) => boolean,
  opts: { bom: 'keep' | 'strip' | 'add' } = { bom: 'keep' },
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const idx = src.index;
  const parts: BlobPart[] = [];

  // BOM is file-level: emit once at start iff (keep && hasBom) || add
  const emitBom = (opts.bom === 'keep' && idx.hasBom) || opts.bom === 'add';
  if (emitBom) {
    parts.push(new Uint8Array([0xef, 0xbb, 0xbf]));
  }

  // Build index for O(1) lineDecision lookup
  const byLineIndex = groupByLine(decisions);

  for (let i = 0; i < idx.lineCount; i++) {
    const d = lineDecision(decisions, byLineIndex, i);

    if (!include(i, d)) continue;

    if (d?.edits && Object.keys(d.edits).length) {
      // Edited line: parse with lossless-json, apply edits, re-serialise
      const text = await src.readText(i);
      let obj = losslessParse(text);

      for (const [path, value] of Object.entries(d.edits)) {
        const segments = parsePath(path);
        obj = setByPath(obj, segments, value);
      }

      const eol = idx.eols[i] === 2 ? '\r\n' : idx.eols[i] === 1 ? '\n' : '';
      parts.push(losslessStringify(obj) + eol);
    } else {
      // Unedited line: raw bytes including terminator
      const raw = await src.readRaw(i);

      // For line 0 with BOM: slice past BOM since we handle it at file level
      if (i === 0 && idx.hasBom) {
        parts.push(raw.slice(3));
      } else {
        parts.push(raw);
      }
    }

    if (onProgress && i % 5000 === 0) {
      onProgress(i, idx.lineCount);
    }
  }

  if (onProgress) {
    onProgress(idx.lineCount, idx.lineCount);
  }

  return new Blob(parts, { type: 'application/jsonl' });
}
