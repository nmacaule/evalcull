/**
 * JSONL reader: produces a RecordSource with byte-exact access.
 */

import type { FileIndex, RecordSource } from '../types';
import { fingerprint } from '../lib/fingerprint';
import IndexerWorker from '../workers/indexer.worker?worker&inline';
import type { IndexerMessage, IndexerResponse } from '../workers/indexer.worker';

export interface JsonlReaderOptions {
  /** Progress callback during indexing */
  onProgress?: (bytes: number, total: number) => void;
}

/**
 * Read a JSONL file and produce a RecordSource.
 *
 * @param file The file to read (or a Blob with name/size/lastModified from /api/meta)
 * @param name File name (for fingerprinting)
 * @param size File size in bytes
 * @param lastModified Last modified timestamp (ms)
 * @param options Reader options
 */
export async function readJsonl(
  file: Blob,
  name: string,
  size: number,
  lastModified: number,
  options: JsonlReaderOptions = {}
): Promise<RecordSource> {
  const fp = await fingerprint(name, size, lastModified);

  const worker = new IndexerWorker();

  const indexResult = await new Promise<{
    starts: Float64Array;
    ends: Float64Array;
    eols: Uint8Array;
    hasBom: boolean;
    lineCount: number;
  }>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<IndexerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress' && options.onProgress) {
        options.onProgress(msg.bytes, msg.total);
      } else if (msg.type === 'indexed') {
        resolve(msg);
      }
    };
    worker.onerror = (e) => reject(new Error(e.message));

    const message: IndexerMessage = { type: 'index', blob: file };
    worker.postMessage(message);
  });

  // Request grouping (stub for now: each line is its own group)
  const groupResult = await new Promise<{
    groups: Uint32Array;
    groupCount: number;
  }>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<IndexerResponse>) => {
      const msg = e.data;
      if (msg.type === 'grouped') {
        resolve(msg);
        worker.terminate();
      }
    };
    worker.onerror = (e) => reject(new Error(e.message));

    const message: IndexerMessage = {
      type: 'group',
      blob: file,
      starts: indexResult.starts,
      ends: indexResult.ends,
      promptPath: '', // Shape detection not yet available (WP 5)
    };
    // Don't transfer starts/ends - we need them for the FileIndex.
    // Once grouping is implemented in WP 5, consider having the worker
    // return them or keeping a copy before transfer.
    worker.postMessage(message);
  });

  const index: FileIndex = {
    fingerprint: fp,
    lineCount: indexResult.lineCount,
    starts: indexResult.starts,
    ends: indexResult.ends,
    eols: indexResult.eols,
    hasBom: indexResult.hasBom,
    groups: groupResult.groups,
    groupCount: groupResult.groupCount,
  };

  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

  return {
    kind: 'jsonl',
    index,
    async readText(i: number): Promise<string> {
      const start = index.starts[i];
      const end = index.ends[i];
      const slice = file.slice(start, end);
      const buffer = await slice.arrayBuffer();
      return decoder.decode(buffer);
    },
    async readRaw(i: number): Promise<Blob> {
      const start = index.starts[i];
      // Include the line ending in raw bytes
      const eol = index.eols[i];
      const end = index.ends[i] + eol;
      return file.slice(start, end);
    },
  };
}
