// @vitest-environment node
/**
 * The real indexer worker module under a stub `self` (WP 7c, D-103 root cause).
 * A pass that throws must tell the page: by a posted message, or by a listener
 * on the worker global for the rejection the HTML Standard reports as
 * unhandledrejection. The test does not depend on the reply's shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Listener = (e: unknown) => void;

const harness = vi.hoisted(() => {
  const posted: unknown[] = [];
  const listeners = new Map<string, Listener[]>();
  const stub = {
    onmessage: null as ((e: { data: unknown }) => unknown) | null,
    onunhandledrejection: null as Listener | null,
    onmessageerror: null as Listener | null,
    postMessage(msg: unknown) {
      posted.push(msg);
    },
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn));
    },
  };
  (globalThis as unknown as { self: typeof stub }).self = stub;

  /** Hands a message to the worker as the browser would, returning what the handlers return. */
  function deliver(data: unknown): unknown[] {
    const event = { data };
    const returned: unknown[] = [];
    if (stub.onmessage) returned.push(stub.onmessage(event));
    for (const l of listeners.get('message') ?? []) returned.push(l(event));
    return returned;
  }

  /** Dispatches an unhandledrejection-shaped event, as the worker global does. */
  function rejected(promise: Promise<unknown>, reason: unknown) {
    let prevented = false;
    const event = {
      type: 'unhandledrejection',
      promise,
      reason,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault() {
        prevented = true;
      },
    };
    stub.onunhandledrejection?.(event);
    for (const l of listeners.get('unhandledrejection') ?? []) l(event);
  }

  // Whether the lib's functions throw (D-103) or are the real ones (WP 7c step 2)
  const lib = { mode: 'throw' as 'throw' | 'real' };

  /** A message that failed to deserialise, as the worker global receives it (messageerror) */
  function undeserialisable() {
    const event = { type: 'messageerror', data: null };
    stub.onmessageerror?.(event);
    for (const l of listeners.get('messageerror') ?? []) l(event);
  }

  return { posted, stub, deliver, rejected, lib, undeserialisable };
});

// Every function the lib modules export throws in the throw arm: the pass fails whatever its name
vi.mock('../src/lib/indexer', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([k, v]) => [
      k,
      typeof v === 'function'
        ? (...args: unknown[]) =>
            harness.lib.mode === 'real'
              ? (v as (...a: unknown[]) => unknown)(...args)
              : Promise.reject(new Error('NotReadableError: The I/O read operation failed.'))
        : v,
    ])
  );
});
vi.mock('../src/lib/secondPass', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([k, v]) => [
      k,
      typeof v === 'function'
        ? (...args: unknown[]) =>
            harness.lib.mode === 'real'
              ? (v as (...a: unknown[]) => unknown)(...args)
              : Promise.reject(new Error('second pass failed'))
        : v,
    ])
  );
});

await import('../src/workers/indexer.worker');

/** Unfaked macrotask turns with fake time advancing; ends when until() holds or the budget is spent. */
async function settle(until: () => boolean): Promise<void> {
  for (let turn = 1; turn <= 600 && !until(); turn++) {
    await new Promise((r) => setImmediate(r));
    if (turn % 10 === 0) await vi.advanceTimersByTimeAsync(1_000);
  }
}

beforeEach(() => {
  harness.posted.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  harness.lib.mode = 'throw';
});

/** An ArrayBuffer of the text's UTF-8 bytes, as the page transfers it. */
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

const posted = (type: string) => harness.posted.filter((m) => (m as { type: string }).type === type);

describe('indexer worker, the ruled protocol (DR-025)', () => {
  // '{"a":1}' CR LF '{"a":2}' LF: 17 bytes, split mid-line and between CR and LF
  const CHUNKS = ['{"a":1}\r', '\n{"a"', ':2}\n'];

  it('indexes the chunks the page sends and acknowledges each', async () => {
    harness.lib.mode = 'real';
    harness.deliver({ type: 'begin', passId: 7, pass: 'index', total: 17 });
    for (const c of CHUNKS) harness.deliver({ type: 'chunk', passId: 7, bytes: bytes(c) });
    harness.deliver({ type: 'end', passId: 7 });

    await settle(() => posted('indexed').length > 0);

    expect({ acks: posted('ack'), indexed: posted('indexed') }).toEqual({
      acks: [
        { type: 'ack', passId: 7 },
        { type: 'ack', passId: 7 },
        { type: 'ack', passId: 7 },
      ],
      indexed: [
        {
          type: 'indexed',
          passId: 7,
          starts: Float64Array.of(0, 9),
          ends: Float64Array.of(7, 16),
          eols: Uint8Array.of(2, 1),
          hasBom: false,
          lineCount: 2,
        },
      ],
    });
  });

  it('groups the chunks the page sends', async () => {
    harness.lib.mode = 'real';
    harness.deliver({
      type: 'begin',
      passId: 8,
      pass: 'group',
      total: 17,
      starts: Float64Array.of(0, 9),
      ends: Float64Array.of(7, 16),
      hasBom: false,
      format: { kind: 'flat', promptPath: 'a', responsePath: 'a' },
    });
    for (const c of CHUNKS) harness.deliver({ type: 'chunk', passId: 8, bytes: bytes(c) });
    harness.deliver({ type: 'end', passId: 8 });

    await settle(() => posted('grouped').length > 0);

    expect(posted('grouped')).toEqual([
      {
        type: 'grouped',
        passId: 8,
        groups: Uint32Array.of(0, 1),
        groupCount: 2,
        unparseable: new Uint32Array(0),
        candidates: Uint16Array.of(1, 1),
      },
    ]);
  });

  it('a message that cannot be deserialised fails the pass in progress (D-108)', async () => {
    harness.lib.mode = 'real';
    harness.deliver({ type: 'begin', passId: 11, pass: 'index', total: 17 });
    harness.undeserialisable();

    await settle(() => posted('failed').length > 0);

    expect(posted('failed').map((m) => (m as { passId: number }).passId)).toEqual([11]);
  });

  it('a message it cannot tie to a pass is reported with no pass id (D-109)', async () => {
    harness.undeserialisable();

    await settle(() => posted('failed').length > 0);

    expect(posted('failed')).toEqual([{ type: 'failed', passId: null, message: 'A message to the indexer could not be read.' }]);
  });

  it('replies failed with the message when a pass throws (D-103, as ruled)', async () => {
    harness.deliver({ type: 'begin', passId: 9, pass: 'index', total: 0 });
    harness.deliver({ type: 'end', passId: 9 });

    await settle(() => posted('failed').length > 0);

    expect(posted('failed')).toEqual([
      { type: 'failed', passId: 9, message: 'NotReadableError: The I/O read operation failed.' },
    ]);
  });
});

describe('indexer worker', () => {
  it('tells the page when a pass throws (D-103)', async () => {
    // The ruled protocol (DR-025): an index pass that begins and ends; its pass throws
    const returned = [
      ...harness.deliver({ type: 'begin', passId: 1, pass: 'index', total: 8 }),
      ...harness.deliver({ type: 'end', passId: 1 }),
    ];
    // Never awaited: a rejection is recorded and reported as the worker global would
    for (const r of returned) {
      if (r instanceof Promise) r.catch((reason) => harness.rejected(r, reason));
    }

    await settle(() => harness.posted.length > 0);

    expect(harness.posted.length).toBeGreaterThan(0);
  });
});
