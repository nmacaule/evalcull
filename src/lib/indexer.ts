/**
 * JSONL indexer: streaming 0x0A scan per §3.4.
 *
 * Testable outside a worker. The worker runs it on the chunks the page sends.
 */

import {
  GrowableFloat64Array,
  GrowableUint8Array,
} from './arrays';

export interface IndexResult {
  starts: Float64Array;
  ends: Float64Array;
  eols: Uint8Array;
  hasBom: boolean;
  lineCount: number;
}

export interface IndexProgress {
  bytes: number;
  total: number;
}

/**
 * Index a file's bytes, chunk by chunk, in order (v3.5: the page reads them
 * and the worker scans them, DR-025).
 *
 * @param chunks The file's bytes in order
 * @param total The file's size in bytes, for progress
 * @param onProgress Optional callback for progress updates
 */
export async function indexChunks(
  chunks: AsyncIterable<Uint8Array>,
  total: number,
  onProgress?: (progress: IndexProgress) => void
): Promise<IndexResult> {
  const starts = new GrowableFloat64Array();
  const ends = new GrowableFloat64Array();
  const eols = new GrowableUint8Array();

  // The first 3 bytes, gathered across chunks, so a first chunk shorter than
  // 3 bytes still detects the BOM
  const head = new Uint8Array(3);
  let headLength = 0;

  let pos = 0;
  let lineStart = 0;
  let prevCR = false;

  for await (const value of chunks) {
    for (let i = 0; i < value.length && headLength < 3; i++) head[headLength++] = value[i];

    for (let i = 0; i < value.length; i++) {
      const b = value[i];
      if (b === 0x0a) {
        const abs = pos + i;
        starts.push(lineStart);
        ends.push(prevCR ? abs - 1 : abs);
        eols.push(prevCR ? 2 : 1);
        lineStart = abs + 1;
      }
      prevCR = b === 0x0d;
    }

    pos += value.length;

    if (onProgress) {
      onProgress({ bytes: pos, total });
    }
  }

  const hasBom = headLength === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;

  // Last line without trailing newline
  if (lineStart < pos) {
    starts.push(lineStart);
    ends.push(pos);
    eols.push(0);
  }

  return {
    starts: starts.trim(),
    ends: ends.trim(),
    eols: eols.trim(),
    hasBom,
    lineCount: starts.length,
  };
}
