/**
 * Windowed reading of a JSONL source for the exporters (PRD §3.6, DR-013).
 *
 * In a browser every Blob slice or read is a call into the browser process, so
 * reading per line or per run made large exports slow (D-094, D-095). The
 * exporters read the source one window of up to READ_WINDOW_BYTES at a time,
 * with one readRawRange each, and take each line's bytes out of the window.
 */

import type { RecordSource } from '../types';

/** The bytes read at once (DR-013): 8 MB. */
const READ_WINDOW_BYTES = 8 * 1024 * 1024;

type JsonlSource = Extract<RecordSource, { kind: 'jsonl' }>;

/** One window: lines first..last and their bytes, from the start of line first. */
export interface LineWindow {
  first: number;
  last: number;
  bytes: Uint8Array;
  /** The bytes of line i without its terminator; line 0 starts past the BOM */
  line(i: number): Uint8Array;
  /** The bytes of line i with its terminator; line 0 starts past the BOM */
  lineWithEol(i: number): Uint8Array;
}

/** The source's lines in windows of up to READ_WINDOW_BYTES; a longer line is a window alone. */
export async function* readWindows(src: JsonlSource): AsyncGenerator<LineWindow> {
  const idx = src.index;
  let first = 0;
  while (first < idx.lineCount) {
    let last = first;
    while (
      last + 1 < idx.lineCount &&
      idx.ends[last + 1] + idx.eols[last + 1] - idx.starts[first] <= READ_WINDOW_BYTES
    ) {
      last++;
    }
    const base = idx.starts[first];
    const bytes = new Uint8Array(await (await src.readRawRange(first, last)).arrayBuffer());
    // The BOM is file-level (WP 4 decision a): line 0's bytes start past it
    const start = (i: number) => (i === 0 && idx.hasBom ? Math.max(idx.starts[i], 3) : idx.starts[i]) - base;
    yield {
      first,
      last,
      bytes,
      line: (i) => bytes.subarray(start(i), idx.ends[i] - base),
      lineWithEol: (i) => bytes.subarray(start(i), idx.ends[i] + idx.eols[i] - base),
    };
    first = last + 1;
  }
}
