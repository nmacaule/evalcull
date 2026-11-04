/**
 * JSONL reader: produces a RecordSource with byte-exact access.
 *
 * WP 5: Returns format and regroup closure for format changes.
 */

import type { FileIndex, RecordSource, RecordFormat } from '../types';
import { fingerprint } from '../lib/fingerprint';
import { detectFormat } from '../lib/schema';
import { readLineText } from '../lib/readLine';
import IndexerWorker from '../workers/indexer.worker?worker&inline';
import type { IndexerMessage, IndexerResponse } from '../workers/indexer.worker';

/** Number of records to sample for shape detection */
const SAMPLE_SIZE = 10;

export interface GroupResult {
  groups: Uint32Array;
  groupCount: number;
  unparseable: Uint32Array;
  candidates: Uint16Array; // candidates per line for the format (WP 6c)
}

export interface JsonlReaderResult {
  source: Extract<RecordSource, { kind: 'jsonl' }>;
  format: RecordFormat;
  /**
   * Re-run grouping with a different format.
   * Closure over the blob and worker this reader owns.
   */
  regroup(format: RecordFormat): Promise<GroupResult>;
  /**
   * Terminate the worker. Call when done with this reader.
   */
  dispose(): void;
}

export interface JsonlReaderOptions {
  /** Progress callback during indexing */
  onProgress?: (bytes: number, total: number) => void;
  /**
   * Skip detection; use this format for grouping.
   * For boot code that has already read a session.
   */
  format?: RecordFormat;
}

/**
 * Read a JSONL file and produce a RecordSource with format detection.
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
): Promise<JsonlReaderResult> {
  const fp = await fingerprint(name, size, lastModified);

  const worker = new IndexerWorker();

  // First pass: byte indexing
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

  // Determine format: use provided or detect
  let format: RecordFormat;
  if (options.format) {
    format = options.format;
  } else {
    // Sample first K parseable records for detection
    const samples: unknown[] = [];
    const limit = Math.min(SAMPLE_SIZE, indexResult.lineCount);

    for (let i = 0; i < indexResult.lineCount && samples.length < limit; i++) {
      try {
        const text = await readLineText(
          file,
          indexResult.starts[i],
          indexResult.ends[i],
          i,
          indexResult.hasBom
        );
        const parsed = JSON.parse(text);
        samples.push(parsed);
      } catch {
        // Skip unparseable lines
      }
    }

    const result = detectFormat(samples);
    format = result.format;
  }

  // Helper to run grouping pass
  async function runGrouping(fmt: RecordFormat): Promise<GroupResult> {
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<IndexerResponse>) => {
        const msg = e.data;
        if (msg.type === 'grouped') {
          resolve({
            groups: msg.groups,
            groupCount: msg.groupCount,
            unparseable: msg.unparseable,
            candidates: msg.candidates,
          });
        }
      };
      worker.onerror = (e) => reject(new Error(e.message));

      const message: IndexerMessage = {
        type: 'group',
        blob: file,
        starts: indexResult.starts,
        ends: indexResult.ends,
        hasBom: indexResult.hasBom,
        format: fmt,
      };
      worker.postMessage(message);
    });
  }

  // Second pass: grouping + unparseable detection
  const groupResult = await runGrouping(format);

  // Build mutable index (groups can be updated by regroup)
  const index: FileIndex = {
    fingerprint: fp,
    lineCount: indexResult.lineCount,
    starts: indexResult.starts,
    ends: indexResult.ends,
    eols: indexResult.eols,
    hasBom: indexResult.hasBom,
    groups: groupResult.groups,
    groupCount: groupResult.groupCount,
    unparseable: groupResult.unparseable,
    candidates: groupResult.candidates,
  };

  const source: Extract<RecordSource, { kind: 'jsonl' }> = {
    kind: 'jsonl',
    index,
    async readText(i: number): Promise<string> {
      return readLineText(file, index.starts[i], index.ends[i], i, index.hasBom);
    },
    async readRaw(i: number): Promise<Blob> {
      const start = index.starts[i];
      // Include the line ending in raw bytes
      const eol = index.eols[i];
      const end = index.ends[i] + eol;
      return file.slice(start, end);
    },
    async readRawRange(from: number, to: number): Promise<Blob> {
      // One slice for a run of lines, terminators included (D-006)
      return file.slice(index.starts[from], index.ends[to] + index.eols[to]);
    },
  };

  // Regroup closure - keeps worker alive
  async function regroup(newFormat: RecordFormat): Promise<GroupResult> {
    const result = await runGrouping(newFormat);
    // Update index in place
    index.groups = result.groups;
    index.groupCount = result.groupCount;
    index.unparseable = result.unparseable;
    index.candidates = result.candidates;
    return result;
  }

  // Dispose function - terminates the worker
  function dispose(): void {
    worker.terminate();
  }

  return { source, format, regroup, dispose };
}
