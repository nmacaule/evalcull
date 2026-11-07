// @vitest-environment node
/**
 * The JSONL reader's regroup (DR-001 rule 4 as amended 5 Nov 2026, D-062):
 * it returns its result and writes nothing into the index; the store writes
 * the index at a switch's commit. The worker is replaced by a fake that speaks
 * the begin/chunk/end protocol (PRD §3.4 (5), DR-025) and answers with
 * hand-written results.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IndexerMessage } from '../src/workers/indexer.worker';
import type { RecordFormat, RecordSource } from '../src/types';

const fake = vi.hoisted(() => ({
  posted: [] as { type: string; passId: number; [k: string]: unknown }[],
  // Hold acknowledgements back, or the answers to a pass's end
  withholdAcks: false,
  holdEnd: false,
  heldAcks: [] as (() => void)[],
  onPost: [] as (() => void)[],
}));

vi.mock('../src/workers/indexer.worker?worker&inline', () => ({
  default: class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    private formats = new Map<number, RecordFormat | null>();
    postMessage(msg: IndexerMessage) {
      fake.posted.push(msg as unknown as (typeof fake.posted)[number]);
      for (const notify of fake.onPost.splice(0)) notify();
      queueMicrotask(() => {
        if (msg.type === 'begin') {
          this.formats.set(msg.passId, msg.pass === 'group' ? msg.format : null);
        } else if (msg.type === 'chunk') {
          const ack = () => this.onmessage?.({ data: { type: 'ack', passId: msg.passId } });
          if (fake.withholdAcks) fake.heldAcks.push(ack);
          else ack();
        } else if (msg.type === 'end' && !fake.holdEnd) {
          const format = this.formats.get(msg.passId);
          if (format === null) {
            this.onmessage?.({
              data: {
                type: 'indexed',
                passId: msg.passId,
                starts: Float64Array.of(0, 8),
                ends: Float64Array.of(7, 15),
                eols: Uint8Array.of(1, 1),
                hasBom: false,
                lineCount: 2,
              },
            });
          } else {
            // The unknown format puts each line in its own group; flat puts both in one
            const one = format?.kind === 'flat';
            this.onmessage?.({
              data: {
                type: 'grouped',
                passId: msg.passId,
                groups: one ? Uint32Array.of(0, 0) : Uint32Array.of(0, 1),
                groupCount: one ? 1 : 2,
                unparseable: new Uint32Array(0),
                candidates: one ? Uint16Array.of(2, 2) : Uint16Array.of(1, 1),
              },
            });
          }
        }
      });
    }
    terminate() {}
  },
}));

const { readJsonl } = await import('../src/readers/jsonl');

/** Resolves when the reader has posted a message matching the test. */
function posted(match: (m: (typeof fake.posted)[number]) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (fake.posted.some(match) ? resolve() : fake.onPost.push(check));
    check();
  });
}

beforeEach(() => {
  fake.posted.length = 0;
  fake.withholdAcks = false;
  fake.holdEnd = false;
  fake.heldAcks.length = 0;
  fake.onPost.length = 0;
});

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

  it('posts the bytes, never a Blob (D-100)', async () => {
    const file = new Blob(['{"a":1}\n{"a":2}\n']);
    const result = await readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } });
    await result.regroup({ kind: 'flat', promptPath: 'a', responsePath: 'a' });

    expect(fake.posted.filter((m) => Object.values(m).some((v) => v instanceof Blob))).toEqual([]);
    // Three passes, each begin, one chunk of the file's 16 bytes, end
    expect(fake.posted.map((m) => m.type)).toEqual(['begin', 'chunk', 'end', 'begin', 'chunk', 'end', 'begin', 'chunk', 'end']);
    expect(fake.posted.filter((m) => m.type === 'chunk').map((m) => (m.bytes as ArrayBuffer).byteLength)).toEqual([16, 16, 16]);
  });

  it('dispose() during a regroup rejects it', async () => {
    const file = new Blob(['{"a":1}\n{"a":2}\n']);
    const result = await readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } });
    fake.holdEnd = true;
    const regrouping = result.regroup({ kind: 'flat', promptPath: 'a', responsePath: 'a' });
    await posted((m) => m.type === 'end' && m.passId === 3);

    result.dispose();

    await expect(regrouping).rejects.toThrow('The reader was disposed.');
  });

  it('keeps at most two chunks in flight until the worker takes them', async () => {
    // 9 MiB: chunks of 4, 4 and 1 MiB
    const file = new Blob([new Uint8Array(9 * 1024 * 1024)]);
    fake.withholdAcks = true;
    const reading = readJsonl(file, 'zeros.jsonl', file.size, 0, { format: { kind: 'unknown' } });
    await posted((m) => m.type === 'chunk' && fake.posted.filter((c) => c.type === 'chunk').length === 2);
    // Turns enough for a third read and post, if the bound did not hold
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    const whileHeld = fake.posted.filter((m) => m.type === 'chunk').length;

    fake.withholdAcks = false;
    for (const ack of fake.heldAcks.splice(0)) ack();
    await reading;

    expect({ whileHeld, total: fake.posted.filter((m) => m.type === 'chunk').length }).toEqual({ whileHeld: 2, total: 6 });
  });
});
