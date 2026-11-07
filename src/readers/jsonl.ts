/**
 * JSONL reader: produces a RecordSource with byte-exact access.
 *
 * WP 5: Returns format and regroup closure for format changes.
 * v3.5 (DR-025): the page reads the file's bytes and transfers them to the
 * worker in chunks; passes run one at a time, whoever calls them, and a pass
 * that fails rejects (D-100, D-103, D-104).
 */

import type { FileIndex, RecordSource, RecordFormat } from '../types';
import { fingerprint } from '../lib/fingerprint';
import { detectFormat } from '../lib/schema';
import { readLineText } from '../lib/readLine';
import { readChunks } from '../lib/chunks';
import IndexerWorker from '../workers/indexer.worker?worker&inline';
import type { IndexerMessage, IndexerResponse } from '../workers/indexer.worker';

/** Number of records to sample for shape detection */
const SAMPLE_SIZE = 10;

/** Chunks posted and not yet taken by the worker, at most (DR-025) */
const MAX_IN_FLIGHT = 2;

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

type IndexResult = Extract<IndexerResponse, { type: 'indexed' }>;
type BeginParams =
  | { pass: 'index' }
  | { pass: 'group'; starts: Float64Array; ends: Float64Array; hasBom: boolean; format: RecordFormat };

/** The pass in progress: its id, how it settles and how its sender waits. */
interface ActivePass {
  passId: number;
  settled: boolean;
  inFlight: number;
  wakeSender: (() => void) | null;
  onProgress?: (bytes: number, total: number) => void;
  resolve(response: IndexerResponse): void;
  reject(err: Error): void;
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

  // The worker in use; a failed pass ends it, and the next pass starts a new one, so
  // nothing a failed pass left in the worker outlives it (DR-027, D-110)
  let worker: Worker | null = null;
  let disposed = false;
  let nextPassId = 0;
  let active: ActivePass | null = null;
  // One pass at a time (D-104): each pass starts when the one before has settled
  let chain: Promise<unknown> = Promise.resolve();

  function retireWorker(): void {
    worker?.terminate();
    worker = null;
  }

  function settle(pass: ActivePass, outcome: () => void, failed = false): void {
    if (pass.settled) return;
    pass.settled = true;
    if (active === pass) active = null;
    pass.wakeSender?.();
    if (failed) retireWorker();
    outcome();
  }

  function fail(pass: ActivePass, err: Error): void {
    settle(pass, () => pass.reject(err), true);
  }

  /** The worker for the next pass, started with its handlers if none is running. */
  function currentWorker(): Worker {
    if (worker) return worker;
    const w: Worker = new IndexerWorker();
    w.onmessage = (e: MessageEvent<IndexerResponse>) => {
      const msg = e.data;
      const pass = active;
      // A reply from a retired worker, or for a pass that has settled, is dropped;
      // a failure with no pass id is the worker's for the pass in progress (D-109)
      if (w !== worker || !pass || (msg.passId !== pass.passId && !(msg.type === 'failed' && msg.passId === null))) return;
      if (msg.type === 'ack') {
        pass.inFlight--;
        pass.wakeSender?.();
      } else if (msg.type === 'progress') {
        pass.onProgress?.(msg.bytes, msg.total);
      } else if (msg.type === 'failed') {
        fail(pass, new Error(msg.message));
      } else {
        settle(pass, () => pass.resolve(msg));
      }
    };
    // A worker script that fails to load, or a synchronous throw in it
    w.onerror = (e) => {
      const pass = active;
      if (w === worker && pass) fail(pass, new Error(e.message));
    };
    // A reply that fails to deserialise carries no pass id; it can only be the pass in
    // progress, which fails (D-108, DR-025 F1; defensive, no such reply is known to occur)
    w.onmessageerror = () => {
      const pass = active;
      if (w === worker && pass) fail(pass, new Error('A reply from the indexer could not be read.'));
    };
    worker = w;
    return w;
  }

  /** Sends the file to the worker as one pass and settles with the worker's answer. */
  function runPass(params: BeginParams, onProgress?: (bytes: number, total: number) => void): Promise<IndexerResponse> {
    const result = chain.then(
      () =>
        new Promise<IndexerResponse>((resolve, reject) => {
          if (disposed) {
            reject(new Error('The reader was disposed.'));
            return;
          }
          const pass: ActivePass = {
            passId: ++nextPassId,
            settled: false,
            inFlight: 0,
            wakeSender: null,
            onProgress,
            resolve,
            reject,
          };
          active = pass;
          const w = currentWorker();
          const begin: IndexerMessage = { type: 'begin', passId: pass.passId, total: file.size, ...params };
          w.postMessage(begin);
          void send(pass, w);
        })
    );
    // The next pass waits for this one whether it fulfils or rejects
    chain = result.catch(() => undefined);
    return result;
  }

  async function send(pass: ActivePass, w: Worker): Promise<void> {
    try {
      for await (const chunk of readChunks(file)) {
        while (!pass.settled && pass.inFlight >= MAX_IN_FLIGHT) {
          await new Promise<void>((resolve) => (pass.wakeSender = resolve));
          pass.wakeSender = null;
        }
        if (pass.settled) return;
        pass.inFlight++;
        const message: IndexerMessage = { type: 'chunk', passId: pass.passId, bytes: chunk.buffer as ArrayBuffer };
        w.postMessage(message, [chunk.buffer]);
      }
      if (!pass.settled) {
        const end: IndexerMessage = { type: 'end', passId: pass.passId };
        w.postMessage(end);
      }
    } catch (err) {
      // The page could not read the file: the pass fails
      fail(pass, err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Performance marks for the §5 Performance row, read by the Playwright measurements
  performance.mark('evalcull:index:start');

  // A read that fails returns no dispose(), so it releases its worker itself
  try {
    return await read();
  } catch (err) {
    disposed = true;
    retireWorker();
    throw err;
  }

  async function read(): Promise<JsonlReaderResult> {
    // First pass: byte indexing
    const first = await runPass({ pass: 'index' }, options.onProgress);
    if (first.type !== 'indexed') throw new Error(`Unexpected reply to an index pass: ${first.type}`);
    const indexResult: IndexResult = first;
    performance.mark('evalcull:first-pass:end');
    performance.measure('evalcull:first-pass', 'evalcull:index:start', 'evalcull:first-pass:end');

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
      const msg = await runPass({
        pass: 'group',
        starts: indexResult.starts,
        ends: indexResult.ends,
        hasBom: indexResult.hasBom,
        format: fmt,
      });
      if (msg.type !== 'grouped') throw new Error(`Unexpected reply to a grouping pass: ${msg.type}`);
      return {
        groups: msg.groups,
        groupCount: msg.groupCount,
        unparseable: msg.unparseable,
        candidates: msg.candidates,
      };
    }

    // Second pass: grouping + unparseable detection
    const groupResult = await runGrouping(format);
    performance.mark('evalcull:second-pass:end');
    performance.measure('evalcull:second-pass', 'evalcull:first-pass:end', 'evalcull:second-pass:end');

    // Build mutable index (the store writes a regroup's result into it at a commit)
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

    // Regroup closure - keeps worker alive. It returns the new grouping and
    // writes nothing into the index: the store writes it at a switch's commit,
    // so a switch that stops leaves the index as it was (DR-001 rule 4, D-062)
    async function regroup(newFormat: RecordFormat): Promise<GroupResult> {
      return runGrouping(newFormat);
    }

    // Dispose function - stops the pass in progress and terminates the worker
    function dispose(): void {
      disposed = true;
      const pass = active;
      if (pass) fail(pass, new Error('The reader was disposed.'));
      retireWorker();
    }

    return { source, format, regroup, dispose };
  }
}
