// @vitest-environment node
/**
 * The JSONL reader against the real indexer worker handler, run in-process
 * (WP 7c): D-103, a worker failure must reject the read; D-104, overlapping
 * regroups must each get their own result. Each fake worker loads its own copy of
 * the worker module and drops it on terminate(), as a browser worker owns its
 * global. The harness knows nothing of the message protocol: it delivers every message both ways with structuredClone
 * (transferred buffers are detached, as in browsers), reports a rejected handler
 * as the worker global's unhandledrejection, and waits only on the outcome.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';

type Listener = (e: unknown) => void;
type PostArgs = [unknown, (Transferable[] | { transfer?: Transferable[] })?];

const harness = vi.hoisted(() => {
  // Which arm the mocked lib plays: every exported function throws, or succeeds
  const state = {
    mode: 'succeed' as 'throw' | 'succeed',
    // D-108: the worker's replies fail to deserialise on the page (messageerror, not message)
    replies: 'deliver' as 'deliver' | 'undeserialisable',
    // D-109: a begin fails to deserialise in the worker (messageerror there, not message)
    loseBegin: false,
  };
  return { state };
});

/** The transfer list of either postMessage form. */
function transferOf(options: PostArgs[1]): Transferable[] {
  if (!options) return [];
  return Array.isArray(options) ? options : (options.transfer ?? []);
}

const als = new AsyncLocalStorage<FakeWorker>();

/** One worker's global: what its copy of the worker module set on self (WP 7c). */
interface WorkerScope {
  onmessage: ((e: { data: unknown }) => unknown) | null;
  onunhandledrejection: Listener | null;
  onmessageerror: Listener | null;
  listeners: Map<string, Listener[]>;
}

// The scope a worker module is being loaded into; outside a load, the scope of the
// fake whose message is being handled
let loading: WorkerScope | null = null;
function scopeNow(): WorkerScope {
  const scope = loading ?? als.getStore()?.scope;
  if (!scope) throw new Error('self used outside a worker load or delivery');
  return scope;
}

const stubSelf = {
  get onmessage() {
    return scopeNow().onmessage;
  },
  set onmessage(fn) {
    scopeNow().onmessage = fn;
  },
  get onunhandledrejection() {
    return scopeNow().onunhandledrejection;
  },
  set onunhandledrejection(fn) {
    scopeNow().onunhandledrejection = fn;
  },
  get onmessageerror() {
    return scopeNow().onmessageerror;
  },
  set onmessageerror(fn) {
    scopeNow().onmessageerror = fn;
  },
  postMessage(...[msg, options]: PostArgs) {
    // A reply reaches the fake whose message the handler is running for
    const fake = als.getStore();
    if (!fake) throw new Error('worker posted outside a delivery');
    const data = structuredClone(msg, { transfer: transferOf(options) });
    queueMicrotask(() =>
      harness.state.replies === 'undeserialisable'
        ? fake.onmessageerror?.({ data: null } as MessageEvent)
        : fake.onmessage?.({ data } as MessageEvent)
    );
  },
  addEventListener(type: string, fn: Listener) {
    const { listeners } = scopeNow();
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  },
  removeEventListener(type: string, fn: Listener) {
    const { listeners } = scopeNow();
    listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn));
  },
};
(globalThis as unknown as { self: typeof stubSelf }).self = stubSelf;

/** A rejection reported as the worker global reports it (HTML Standard, unhandledrejection). */
function reportRejection(scope: WorkerScope, promise: Promise<unknown>, reason: unknown) {
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
  scope.onunhandledrejection?.(event);
  for (const l of scope.listeners.get('unhandledrejection') ?? []) l(event);
}

/** Every fake worker the reader has created, in order (D-110) */
const created: FakeWorker[] = [];

// Fresh copies of the worker module, each loaded into its own scope before the test's
// fake timers start (module loading waits on a timer); each fake worker takes one
const pool: WorkerScope[] = [];

async function loadScope(): Promise<WorkerScope> {
  const scope: WorkerScope = { onmessage: null, onunhandledrejection: null, onmessageerror: null, listeners: new Map() };
  loading = scope;
  try {
    // A fresh copy each time: the registry is cleared, the mocks are kept
    vi.resetModules();
    await import('../src/workers/indexer.worker');
  } finally {
    loading = null;
  }
  return scope;
}

/**
 * A worker with its own copy of the real worker module, as a browser worker has
 * its own global; terminate() drops it, and with it every pass the worker held.
 */
class FakeWorker {
  terminated = false;
  scope: WorkerScope | null;
  constructor() {
    created.push(this);
    const scope = pool.shift();
    if (!scope) throw new Error('no preloaded worker module left; raise the pool size');
    this.scope = scope;
  }
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  postMessage(...[msg, options]: PostArgs) {
    const data = structuredClone(msg, { transfer: transferOf(options) });
    queueMicrotask(() =>
      als.run(this, () => {
        const scope = this.scope;
        // A terminated worker runs nothing
        if (!scope) return;
        if (harness.state.loseBegin && (data as { type?: string }).type === 'begin') {
          scope.onmessageerror?.({ data: null });
          for (const l of scope.listeners.get('messageerror') ?? []) l({ data: null });
          return;
        }
        const event = { data };
        const returned: unknown[] = [];
        if (scope.onmessage) returned.push(scope.onmessage(event));
        for (const l of scope.listeners.get('message') ?? []) returned.push(l(event));
        // Registered inside the run, so a report posted from it reaches this fake
        for (const r of returned) {
          if (r instanceof Promise) r.catch((reason) => reportRejection(scope, r, reason));
        }
      })
    );
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (type === 'message') this.onmessage = fn;
  }
  terminate() {
    this.terminated = true;
    this.scope = null;
  }
}

vi.mock('../src/workers/indexer.worker?worker&inline', () => ({ default: FakeWorker }));

/** Consumes any async-iterable argument, so a sender bounded by acknowledgements is never stalled. */
async function drain(args: unknown[]) {
  for (const a of args) {
    if (a && typeof (a as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      for await (const _ of a as AsyncIterable<unknown>) void _;
    }
  }
}

// Hand-written results for the two-line file {"a":1}\n{"a":2}\n; fresh arrays on every call
vi.mock('../src/lib/indexer', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const fake = async (...args: unknown[]) => {
    await drain(args);
    if (harness.state.mode === 'throw') throw new Error('NotReadableError: The I/O read operation failed.');
    return {
      starts: Float64Array.of(0, 8),
      ends: Float64Array.of(7, 15),
      eols: Uint8Array.of(1, 1),
      hasBom: false,
      lineCount: 2,
    };
  };
  return Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === 'function' ? fake : v]));
});
vi.mock('../src/lib/secondPass', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const fake = async (...args: unknown[]) => {
    await drain(args);
    if (harness.state.mode === 'throw') throw new Error('second pass failed');
    // The format is the argument with a string kind, wherever it sits
    const format = args.find(
      (a): a is { kind: string } => !!a && typeof a === 'object' && typeof (a as { kind?: unknown }).kind === 'string'
    );
    const flat = format?.kind === 'flat';
    return {
      groups: flat ? Uint32Array.of(0, 0) : Uint32Array.of(0, 1),
      groupCount: flat ? 1 : 2,
      unparseable: new Uint32Array(0),
      candidates: flat ? Uint16Array.of(2, 2) : Uint16Array.of(1, 1),
    };
  };
  return Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === 'function' ? fake : v]));
});

const { readJsonl } = await import('../src/readers/jsonl');

type Tracked<T> = { state: 'pending' | 'fulfilled' | 'rejected'; value?: T; reason?: unknown };

function track<T>(p: Promise<T>): Tracked<T> {
  const t: Tracked<T> = { state: 'pending' };
  p.then(
    (value) => Object.assign(t, { state: 'fulfilled', value }),
    (reason) => Object.assign(t, { state: 'rejected', reason })
  );
  return t;
}

/** Unfaked macrotask turns with fake time advancing; ends when until() holds or the budget is spent. */
async function settle(until: () => boolean): Promise<void> {
  for (let turn = 1; turn <= 600 && !until(); turn++) {
    await new Promise((r) => setImmediate(r));
    if (turn % 10 === 0) await vi.advanceTimersByTimeAsync(1_000);
  }
}

const TEXT = '{"a":1}\n{"a":2}\n';

beforeEach(async () => {
  // Four workers at most in any test here (D-110 uses two); loaded before the fake timers
  pool.length = 0;
  for (let i = 0; i < 4; i++) pool.push(await loadScope());
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  harness.state.mode = 'succeed';
  harness.state.replies = 'deliver';
  harness.state.loseBegin = false;
  created.length = 0;
});

describe('the reader with the real worker handler', () => {
  it('control: a read whose passes succeed is fulfilled', async () => {
    harness.state.mode = 'succeed';
    const file = new Blob([TEXT]);
    const read = track(readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } }));
    await settle(() => read.state !== 'pending');
    expect(read.state).toBe('fulfilled');
  });

  it('a worker failure rejects the read (D-103)', async () => {
    harness.state.mode = 'throw';
    const file = new Blob([TEXT]);
    const read = track(readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } }));
    await settle(() => read.state !== 'pending');
    expect(read.state).toBe('rejected');
  });

  it('a reply that cannot be deserialised rejects the read (D-108)', async () => {
    harness.state.replies = 'undeserialisable';
    const file = new Blob([TEXT]);
    const read = track(readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } }));
    await settle(() => read.state !== 'pending');
    expect(read.state).toBe('rejected');
  });

  it('a begin the worker cannot read rejects the read (D-109)', async () => {
    harness.state.loseBegin = true;
    const file = new Blob([TEXT]);
    const read = track(readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } }));
    await settle(() => read.state !== 'pending');
    expect(read.state).toBe('rejected');
  });

  it('a regroup the page fails ends its worker, and the next regroup runs on a new one (D-110)', async () => {
    // A file that can be read until it changes on disk
    class ChangingBlob extends Blob {
      changed = false;
      slice(start?: number, end?: number, contentType?: string): Blob {
        if (this.changed) {
          return { arrayBuffer: () => Promise.reject(new Error('NotReadableError: The file changed.')) } as unknown as Blob;
        }
        return super.slice(start, end, contentType);
      }
    }
    const file = new ChangingBlob([TEXT]);
    const read = track(readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } }));
    await settle(() => read.state !== 'pending');
    expect(read.state).toBe('fulfilled');
    const reader = read.value!;

    file.changed = true;
    const failed = track(reader.regroup({ kind: 'flat', promptPath: 'a', responsePath: 'a' }));
    await settle(() => failed.state !== 'pending');
    file.changed = false;
    const next = track(reader.regroup({ kind: 'flat', promptPath: 'a', responsePath: 'a' }));
    await settle(() => next.state !== 'pending');

    expect({
      failed: failed.state,
      next: { state: next.state, groupCount: next.value?.groupCount },
      workers: created.map((w) => w.terminated),
    }).toEqual({
      failed: 'rejected',
      next: { state: 'fulfilled', groupCount: 1 },
      // The first worker ends with the failed pass; the second is the reader's now
      workers: [true, false],
    });
  });

  it('overlapping regroups each get their own result (D-104)', async () => {
    harness.state.mode = 'succeed';
    const file = new Blob([TEXT]);
    const read = track(readJsonl(file, 'two.jsonl', file.size, 0, { format: { kind: 'unknown' } }));
    await settle(() => read.state !== 'pending');
    expect(read.state).toBe('fulfilled');

    const reader = read.value!;
    const toFlat = track(reader.regroup({ kind: 'flat', promptPath: 'a', responsePath: 'a' }));
    const toUnknown = track(reader.regroup({ kind: 'unknown' }));
    await settle(() => toFlat.state !== 'pending' && toUnknown.state !== 'pending');

    expect({
      flat: { state: toFlat.state, groupCount: toFlat.value?.groupCount },
      unknown: { state: toUnknown.state, groupCount: toUnknown.value?.groupCount },
    }).toEqual({
      flat: { state: 'fulfilled', groupCount: 1 },
      unknown: { state: 'fulfilled', groupCount: 2 },
    });
  });
});
