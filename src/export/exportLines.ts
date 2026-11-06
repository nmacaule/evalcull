/**
 * Byte-exact JSONL export per §3.6.
 *
 * For unedited lines: copies raw bytes including terminator.
 * For edited lines: parses with lossless-json, applies edits, re-serialises.
 *
 * Deviations from §3.6: idx is accessed via src.index instead of separate parameter.
 * The BOM is file-level (WP 4 decision a): line 0's raw bytes are always sliced
 * past it and it is emitted once at the start for keep-with-BOM or add, where the
 * §3.6 sketch passes it through and slices only for strip. The bytes match when
 * line 0 is included and unedited; when line 0 is edited or not included, the
 * code keeps the file's BOM where the sketch would drop it.
 */

import type { RecordSource, CandidateRef, Decision } from '../types';
import { groupByLine, lineDecision } from '../store/refs';
import { losslessParse, losslessStringify } from '../lib/lossless';
import { parsePath, setByPath } from '../lib/path';
import { readWindows } from './windows';

const YIELD_INTERVAL = 5000;

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

  // The source is read in windows (readWindows, DR-013); unedited included lines are
  // copied byte for byte out of the window, never parsed, and each window's output
  // is one part (D-094)
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const encoder = new TextEncoder();
  for await (const win of readWindows(src)) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (let i = win.first; i <= win.last; i++) {
      const d = lineDecision(decisions, byLineIndex, i);
      if (include(i, d)) {
        let out: Uint8Array;
        if (d?.edits && Object.keys(d.edits).length) {
          // Edited line: parse with lossless-json, apply edits, re-serialise
          let obj = losslessParse(decoder.decode(win.line(i)));
          for (const [path, value] of Object.entries(d.edits)) {
            const segments = parsePath(path);
            obj = setByPath(obj, segments, value);
          }
          const eol = idx.eols[i] === 2 ? '\r\n' : idx.eols[i] === 1 ? '\n' : '';
          out = encoder.encode(losslessStringify(obj) + eol);
        } else {
          // Unedited line: its raw bytes, terminator included
          out = win.lineWithEol(i);
        }
        chunks.push(out);
        size += out.length;
      }

      // Yield to allow page paint, as the other exporters do (D-008)
      if (i % YIELD_INTERVAL === 0) {
        await new Promise((r) => setTimeout(r, 0));
        if (onProgress) {
          onProgress(i, idx.lineCount);
        }
      }
    }

    const part = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      part.set(chunk, at);
      at += chunk.length;
    }
    if (size > 0) parts.push(part);
  }

  if (onProgress) {
    onProgress(idx.lineCount, idx.lineCount);
  }

  return new Blob(parts, { type: 'application/jsonl' });
}
