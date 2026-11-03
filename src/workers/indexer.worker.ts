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
 * Main thread → Worker (grouping + unparseable, WP 5):
 *   { type: 'group', blob: Blob, starts, ends, hasBom, format: RecordFormat }
 *
 * Worker → Main thread (grouping complete):
 *   { type: 'grouped', groups: Uint32Array, groupCount: number, unparseable: Uint32Array }
 *   Transfer list: [groups.buffer, unparseable.buffer]
 */

import type { RecordFormat } from '../types';
import { indexBlob } from '../lib/indexer';
import { secondPass } from '../lib/secondPass';

export type IndexerMessage =
  | { type: 'index'; blob: Blob }
  | {
      type: 'group';
      blob: Blob;
      starts: Float64Array;
      ends: Float64Array;
      hasBom: boolean;
      format: RecordFormat;
    };

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
  | { type: 'grouped'; groups: Uint32Array; groupCount: number; unparseable: Uint32Array };

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
    // WP 5: real grouping with format-based key extraction + unparseable detection
    const result = await secondPass(
      msg.blob,
      msg.starts,
      msg.ends,
      msg.hasBom,
      msg.format
    );

    const response: IndexerResponse = {
      type: 'grouped',
      groups: result.groups,
      groupCount: result.groupCount,
      unparseable: result.unparseable,
    };

    self.postMessage(response, {
      transfer: [result.groups.buffer, result.unparseable.buffer],
    });
  }
};
