/**
 * Second pass over a JSONL file's bytes: unparseable detection + grouping in one read.
 *
 * Takes the bytes in chunks, decodes and JSON.parse each line once.
 * Extracts grouping key per format and assigns group IDs.
 * Records unparseable line indices.
 * WP 6c: records each line's candidate count for the format.
 */

import type { RecordFormat } from '../types';
import { hash64, GroupIdMap, extractGroupKey } from './groups';
import { parsePath, getByPath, type PathSegment } from './path';

export interface SecondPassResult {
  unparseable: Uint32Array;
  groups: Uint32Array;
  groupCount: number;
  candidates: Uint16Array;
}

/** Largest count a Uint16Array holds. */
const MAX_CANDIDATES = 65535;

/**
 * Build the per-line candidate counter for a format (WP 6c).
 * Row formats: 1. preference: 2. candidates: array length at candidatesPath,
 * 0 when missing or not an array, capped at 65535. Called for parsed lines only;
 * an unparseable line is 0.
 */
function candidateCounter(format: RecordFormat): (parsed: unknown) => number {
  if (format.kind === 'preference') return () => 2;
  if (format.kind !== 'candidates') return () => 1;

  let segments: PathSegment[];
  try {
    segments = parsePath(format.candidatesPath);
  } catch {
    return () => 0;
  }
  return (parsed) => {
    const value = getByPath(parsed, segments);
    return Array.isArray(value) ? Math.min(value.length, MAX_CANDIDATES) : 0;
  };
}

/**
 * Single streaming pass for unparseable detection and grouping.
 *
 * @param chunks The file's bytes in order (v3.5: read by the page, DR-025)
 * @param starts Line start offsets
 * @param ends Line end offsets (before line ending)
 * @param hasBom Whether the file starts with a UTF-8 BOM
 * @param format Record format for grouping key extraction
 */
export async function secondPass(
  chunks: AsyncIterable<Uint8Array>,
  starts: Float64Array,
  ends: Float64Array,
  hasBom: boolean,
  format: RecordFormat
): Promise<SecondPassResult> {
  const lineCount = starts.length;
  if (lineCount === 0) {
    return {
      unparseable: new Uint32Array(0),
      groups: new Uint32Array(0),
      groupCount: 0,
      candidates: new Uint16Array(0),
    };
  }

  const unparseable: number[] = [];
  const groups = new Uint32Array(lineCount);
  const candidates = new Uint16Array(lineCount); // 0 until a line parses
  const countCandidates = candidateCounter(format);
  const groupIdMap = new GroupIdMap();

  // ignoreBOM: true so decoder does NOT auto-strip; we skip bytes explicitly for line 0
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

  // Take the bytes chunk by chunk, tracking position
  let buffer = new Uint8Array(0);
  let bufferStart = 0; // absolute position of buffer[0] in the file
  let lineIdx = 0;

  // Track whether format provides grouping
  const hasGrouping =
    format.kind !== 'unknown' &&
    !(format.kind === 'preference' && !format.promptPath);

  for await (const value of chunks) {
    // Append chunk to buffer
    const newBuffer = new Uint8Array(buffer.length + value.length);
    newBuffer.set(buffer);
    newBuffer.set(value, buffer.length);
    buffer = newBuffer;

    // Process all complete lines we can from the buffer
    while (lineIdx < lineCount) {
      const lineStart = starts[lineIdx];
      const lineEnd = ends[lineIdx];

      // Check if this line is fully in the buffer
      const localStart = lineStart - bufferStart;
      const localEnd = lineEnd - bufferStart;

      if (localEnd > buffer.length) {
        // Need more data for this line
        break;
      }

      // Extract line bytes
      let lineBytes: Uint8Array;
      if (lineIdx === 0 && hasBom && localStart === 0) {
        // Skip BOM for line 0
        lineBytes = buffer.subarray(Math.max(localStart, 3), localEnd);
      } else {
        lineBytes = buffer.subarray(localStart, localEnd);
      }

      // Decode and try to parse
      const text = decoder.decode(lineBytes);
      let parsed: unknown;
      let parseOk = false;

      try {
        parsed = JSON.parse(text);
        parseOk = true;
      } catch {
        unparseable.push(lineIdx);
      }

      if (parseOk) candidates[lineIdx] = countCandidates(parsed);

      // Assign group ID
      if (!parseOk || !hasGrouping) {
        // Unparseable or no grouping: each line is its own group
        groups[lineIdx] = groupIdMap.getOrCreate(lineIdx, 0);
      } else {
        // Extract grouping key and hash
        const key = extractGroupKey(parsed, format);
        if (key === undefined) {
          // No key extracted: own group
          groups[lineIdx] = groupIdMap.getOrCreate(lineIdx, 0);
        } else {
          const [hi, lo] = hash64(key);
          groups[lineIdx] = groupIdMap.getOrCreate(hi, lo);
        }
      }

      lineIdx++;
    }

    // Trim processed bytes from buffer
    if (lineIdx > 0 && lineIdx <= lineCount) {
      const lastProcessedEnd =
        lineIdx < lineCount ? ends[lineIdx - 1] : ends[lineCount - 1];
      const trimPoint = lastProcessedEnd - bufferStart;
      if (trimPoint > 0 && trimPoint <= buffer.length) {
        buffer = buffer.subarray(trimPoint);
        bufferStart = lastProcessedEnd;
      }
    }
  }

  return {
    unparseable: Uint32Array.from(unparseable),
    groups,
    groupCount: groupIdMap.count,
    candidates,
  };
}
