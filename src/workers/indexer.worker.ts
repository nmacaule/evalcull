/**
 * JSONL indexer Web Worker per §3.4 (v3.5, DR-025).
 *
 * The page reads the file's bytes and transfers them here in chunks; the worker
 * never receives a Blob, because in WebKit a worker of a page opened from
 * file:// cannot read the page's Blobs (D-100). Every message of a pass carries
 * its pass id.
 *
 * Message protocol:
 *
 * Main thread → Worker:
 *   { type: 'begin', passId, pass: 'index', total }
 *   { type: 'begin', passId, pass: 'group', total, starts, ends, hasBom, format }
 *   { type: 'chunk', passId, bytes: ArrayBuffer }   // transferred
 *   { type: 'end', passId }
 *
 * Worker → Main thread:
 *   { type: 'ack', passId }                        // one per chunk, once the pass has taken it
 *   { type: 'progress', passId, bytes, total }     // the index pass only
 *   { type: 'indexed', passId, starts, ends, eols, hasBom, lineCount }
 *     Transfer list: [starts.buffer, ends.buffer, eols.buffer]
 *   { type: 'grouped', passId, groups, groupCount, unparseable, candidates }
 *     Transfer list: [groups.buffer, unparseable.buffer, candidates.buffer]
 *   { type: 'failed', passId, message }            // the pass threw, or a message could not be read (D-103, D-108)
 *   { type: 'failed', passId: null, message }      // a message could not be read and no pass is held (D-109)
 */

import type { RecordFormat } from '../types';
import { indexChunks } from '../lib/indexer';
import { secondPass } from '../lib/secondPass';

export type IndexerMessage =
  | { type: 'begin'; passId: number; pass: 'index'; total: number }
  | {
      type: 'begin';
      passId: number;
      pass: 'group';
      total: number;
      starts: Float64Array;
      ends: Float64Array;
      hasBom: boolean;
      format: RecordFormat;
    }
  | { type: 'chunk'; passId: number; bytes: ArrayBuffer }
  | { type: 'end'; passId: number };

export type IndexerResponse =
  | { type: 'ack'; passId: number }
  | { type: 'progress'; passId: number; bytes: number; total: number }
  | {
      type: 'indexed';
      passId: number;
      starts: Float64Array;
      ends: Float64Array;
      eols: Uint8Array;
      hasBom: boolean;
      lineCount: number;
    }
  | {
      type: 'grouped';
      passId: number;
      groups: Uint32Array;
      groupCount: number;
      unparseable: Uint32Array;
      candidates: Uint16Array;
    }
  | { type: 'failed'; passId: number | null; message: string };

/**
 * A pass's chunks as they arrive. A chunk is acknowledged when the pass takes
 * it, so the page's in-flight bound limits what waits here.
 */
class ChunkQueue implements AsyncIterable<Uint8Array> {
  private items: Uint8Array[] = [];
  private ended = false;
  private wake: (() => void) | null = null;
  private failure: Error | null = null;
  private readonly passId: number;

  constructor(passId: number) {
    this.passId = passId;
  }

  push(bytes: ArrayBuffer): void {
    this.items.push(new Uint8Array(bytes));
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  /** The pass taking these chunks throws at its next read, and so replies failed (D-108). */
  fail(err: Error): void {
    this.failure = err;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (this.failure) throw this.failure;
      const next = this.items.shift();
      if (next) {
        post({ type: 'ack', passId: this.passId });
        yield next;
      } else if (this.ended) {
        return;
      } else {
        await new Promise<void>((resolve) => (this.wake = resolve));
        this.wake = null;
      }
    }
  }
}

function post(response: IndexerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

const queues = new Map<number, ChunkQueue>();

/** Runs one pass; a pass that throws replies failed with its message (D-103). */
async function run(msg: Extract<IndexerMessage, { type: 'begin' }>, queue: ChunkQueue): Promise<void> {
  const { passId } = msg;
  try {
    if (msg.pass === 'index') {
      const result = await indexChunks(queue, msg.total, (progress) =>
        post({ type: 'progress', passId, ...progress })
      );
      // Transfer buffers, do not copy
      post(
        {
          type: 'indexed',
          passId,
          starts: result.starts,
          ends: result.ends,
          eols: result.eols,
          hasBom: result.hasBom,
          lineCount: result.lineCount,
        },
        [result.starts.buffer, result.ends.buffer, result.eols.buffer]
      );
    } else {
      // WP 5: grouping with format-based key extraction + unparseable detection
      const result = await secondPass(queue, msg.starts, msg.ends, msg.hasBom, msg.format);
      post(
        {
          type: 'grouped',
          passId,
          groups: result.groups,
          groupCount: result.groupCount,
          unparseable: result.unparseable,
          candidates: result.candidates,
        },
        [result.groups.buffer, result.unparseable.buffer, result.candidates.buffer]
      );
    }
  } catch (err) {
    post({ type: 'failed', passId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    queues.delete(passId);
  }
}

// A message that fails to deserialise carries no pass id, so every pass held fails
// and is dropped (D-108, DR-025 F1); holding none, the worker says so without one,
// and the page fails its pass in progress (D-109, DR-027). Defensive: no such
// message is known to occur
self.onmessageerror = () => {
  const message = 'A message to the indexer could not be read.';
  if (queues.size === 0) post({ type: 'failed', passId: null, message });
  for (const queue of queues.values()) queue.fail(new Error(message));
};

self.onmessage = (e: MessageEvent<IndexerMessage>) => {
  const msg = e.data;
  if (msg.type === 'begin') {
    const queue = new ChunkQueue(msg.passId);
    queues.set(msg.passId, queue);
    void run(msg, queue);
  } else if (msg.type === 'chunk') {
    queues.get(msg.passId)?.push(msg.bytes);
  } else if (msg.type === 'end') {
    queues.get(msg.passId)?.end();
  }
};
