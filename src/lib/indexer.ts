/**
 * JSONL indexer: streaming 0x0A scan per §3.4.
 *
 * Testable outside a worker. The worker re-exports this with message handling.
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
 * Index a blob, streaming through its bytes.
 *
 * @param blob The blob to index
 * @param onProgress Optional callback for progress updates
 */
export async function indexBlob(
  blob: Blob,
  onProgress?: (progress: IndexProgress) => void
): Promise<IndexResult> {
  const starts = new GrowableFloat64Array();
  const ends = new GrowableFloat64Array();
  const eols = new GrowableUint8Array();

  // Detect BOM from the first 3 bytes before scanning.
  // This avoids fragility if the first chunk is < 3 bytes.
  let hasBom = false;
  if (blob.size >= 3) {
    const first3 = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    hasBom = first3[0] === 0xef && first3[1] === 0xbb && first3[2] === 0xbf;
  }

  let pos = 0;
  let lineStart = 0;
  let prevCR = false;

  const reader = blob.stream().getReader();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

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
      onProgress({ bytes: pos, total: blob.size });
    }
  }

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
