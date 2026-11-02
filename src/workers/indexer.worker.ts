/**
 * JSONL indexer Web Worker per §3.4.
 *
 * Message protocol:
 *
 * Main thread → Worker (index):
 *   { type: 'index', blob: Blob }
 *
 * Worker → Main thread (progress):
 *   { type: 'progress', bytes: number, total: number }
 *
 * Worker → Main thread (index complete):
 *   { type: 'indexed', starts, ends, eols, hasBom, lineCount }
 *   Transfer list: [starts.buffer, ends.buffer, eols.buffer]
 *
 * Main thread → Worker (grouping, WP 5):
 *   { type: 'group', blob: Blob, starts, ends, promptPath: string }
 *   Transfer list: [starts.buffer, ends.buffer]
 *
 * Worker → Main thread (grouping complete, WP 5):
 *   { type: 'grouped', groups: Uint32Array, groupCount: number }
 *   Transfer list: [groups.buffer]
 */

import { indexBlob } from '../lib/indexer';

export type IndexerMessage =
  | { type: 'index'; blob: Blob }
  | { type: 'group'; blob: Blob; starts: Float64Array; ends: Float64Array; promptPath: string };

export type IndexerResponse =
  | { type: 'progress'; bytes: number; total: number }
  | {
      type: 'indexed';
      starts: Float64Array;
      ends: Float64Array;
      eols: Uint8Array;
      hasBom: boolean;
      lineCount: number;
    }
  | { type: 'grouped'; groups: Uint32Array; groupCount: number };

self.onmessage = async (e: MessageEvent<IndexerMessage>) => {
  const msg = e.data;

  if (msg.type === 'index') {
    const result = await indexBlob(msg.blob, (progress) => {
      self.postMessage({ type: 'progress', ...progress });
    });

    const response: IndexerResponse = {
      type: 'indexed',
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      lineCount: result.lineCount,
    };

    // Transfer buffers, do not copy
    self.postMessage(response, {
      transfer: [result.starts.buffer, result.ends.buffer, result.eols.buffer],
    });
  } else if (msg.type === 'group') {
    // Grouping logic added in WP 5 after shape detection is available.
    // For now, each line is its own group: groups[i] = i, groupCount = lineCount.
    const lineCount = msg.starts.length;
    const groups = new Uint32Array(lineCount);
    for (let i = 0; i < lineCount; i++) {
      groups[i] = i;
    }

    const response: IndexerResponse = {
      type: 'grouped',
      groups,
      groupCount: lineCount,
    };

    self.postMessage(response, { transfer: [groups.buffer] });
  }
};
