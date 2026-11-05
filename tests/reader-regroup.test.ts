/**
 * The JSONL reader's regroup (DR-001 rule 4 as amended 5 Nov 2026, D-062):
 * it returns its result and writes nothing into the index; the store writes
 * the index at a switch's commit. The worker is replaced by a fake that
 * answers the index and group messages with hand-written results.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IndexerMessage } from '../src/workers/indexer.worker';
import type { RecordSource } from '../src/types';

vi.mock('../src/workers/indexer.worker?worker&inline', () => ({
  default: class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    postMessage(msg: IndexerMessage) {
      queueMicrotask(() => {
        if (msg.type === 'index') {
          this.onmessage?.({
            data: {
              type: 'indexed',
              starts: Float64Array.of(0, 8),
              ends: Float64Array.of(7, 15),
              eols: Uint8Array.of(1, 1),
              hasBom: false,
              lineCount: 2,
            },
          });
        } else if (msg.type === 'group') {
          // The unknown format puts each line in its own group; flat puts both in one
          const one = msg.format.kind === 'flat';
          this.onmessage?.({
            data: {
              type: 'grouped',
              groups: one ? Uint32Array.of(0, 0) : Uint32Array.of(0, 1),
              groupCount: one ? 1 : 2,
              unparseable: new Uint32Array(0),
              candidates: one ? Uint16Array.of(2, 2) : Uint16Array.of(1, 1),
            },
          });
        }
      });
    }
    terminate() {}
  },
}));

const { readJsonl } = await import('../src/readers/jsonl');

describe('readJsonl regroup', () => {
  it('returns the new grouping and writes nothing into the index (D-062)', async () => {
    const file = new Blob(['{"a":1}\n{"a":2}\n']);
    const result = await readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } });

    const regrouped = await result.regroup({ kind: 'flat', promptPath: 'a', responsePath: 'a' });

    expect({
      returned: regrouped.groupCount,
      index: (result.source as Extract<RecordSource, { kind: 'jsonl' }>).index.groupCount,
    }).toEqual({ returned: 1, index: 2 });
  });
});
