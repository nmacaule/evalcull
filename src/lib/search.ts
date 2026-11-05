/**
 * Raw-text search for / (PRD §2.2; owner Q5, 4 Nov 2026). Case-insensitive
 * substring over each line's raw bytes, read in runs of RUN lines through
 * readRawRange and yielding between runs, so the main thread never parses the
 * file (PRD §3.4). A run is split into lines by the index's byte offsets, never
 * by character offsets. The caller's isStale() is checked after every yield.
 *
 * Order: single mode from the line after the cursor, wrapping, the cursor line
 * last; compare mode from the line after the current prompt's first line,
 * wrapping, with the current prompt's own lines counted apart.
 */

import type { RecordSource } from '../types';

const RUN = 5000;

export type SearchResult =
  | { kind: 'match'; line: number }
  | { kind: 'only-current' }
  | { kind: 'none' }
  | { kind: 'stale' };

export interface SearchOptions {
  query: string;
  mode: 'compare' | 'single';
  /** Prompt index in compare mode, line index in single mode */
  cursor: number;
  isStale: () => boolean;
}

export async function searchRaw(
  source: Extract<RecordSource, { kind: 'jsonl' }>,
  opts: SearchOptions
): Promise<SearchResult> {
  const { index } = source;
  const total = index.lineCount;
  const needle = opts.query.toLowerCase();
  if (total === 0 || needle === '') return { kind: 'none' };

  // The current record or prompt, whose own matches do not move the cursor
  let first: number;
  let isCurrent: (line: number) => boolean;
  if (opts.mode === 'compare') {
    const g = opts.cursor;
    first = index.groups.indexOf(g);
    if (first === -1) first = 0;
    isCurrent = (line) => index.groups[line] === g;
  } else {
    first = opts.cursor;
    isCurrent = (line) => line === opts.cursor;
  }

  const decoder = new TextDecoder();
  let currentMatched = false;

  // Lines first+1 … total-1, then 0 … first, as contiguous segments
  const segments: Array<[number, number]> = [];
  if (first + 1 <= total - 1) segments.push([first + 1, total - 1]);
  segments.push([0, Math.min(first, total - 1)]);

  for (const [segStart, segEnd] of segments) {
    for (let from = segStart; from <= segEnd; from += RUN) {
      const to = Math.min(from + RUN - 1, segEnd);
      const bytes = new Uint8Array(await (await source.readRawRange(from, to)).arrayBuffer());
      const base = index.starts[from];
      for (let line = from; line <= to; line++) {
        const text = decoder.decode(bytes.subarray(index.starts[line] - base, index.ends[line] - base));
        if (!text.toLowerCase().includes(needle)) continue;
        if (isCurrent(line)) {
          currentMatched = true;
          continue;
        }
        return { kind: 'match', line };
      }
      await new Promise<void>((r) => setTimeout(r, 0));
      if (opts.isStale()) return { kind: 'stale' };
    }
  }

  return currentMatched ? { kind: 'only-current' } : { kind: 'none' };
}
