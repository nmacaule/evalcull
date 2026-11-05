/**
 * Saving on page close (D-005): the pagehide size guard (A), IndexedDB written
 * before the sidecar PUT in the lifecycle flushes (B), keepalive kept on a
 * chained follow-up (F), and the beforeunload prompt while a save is pending (G).
 *
 * Oracle: the keepalive quota (65,536 bytes, Fetch standard), the PUT options and
 * IndexedDB contents observed through the configureSidecar and configureStorage
 * seams, and the event's defaultPrevented flag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar, type SidecarTransport } from '../src/store/persistence';
import type { FileIndex, RecordSource } from '../src/types';
import { resetStore } from './helpers/app';

const KEEPALIVE_QUOTA = 65536;

function createMockSource(lineCount: number): RecordSource {
  const index: FileIndex = {
    fingerprint: 'lifecycle-fp',
    lineCount,
    starts: new Float64Array(lineCount),
    ends: new Float64Array(lineCount),
    eols: new Uint8Array(lineCount),
    hasBom: false,
    groups: Uint32Array.from({ length: lineCount }, (_, i) => i),
    groupCount: lineCount,
    unparseable: new Uint32Array(0),
    candidates: new Uint16Array(lineCount).fill(1),
  };
  return {
    kind: 'jsonl',
    index,
    readText: async (i: number) => JSON.stringify({ line: i }),
    readRaw: async (i: number) => new Blob([JSON.stringify({ line: i })]),
    readRawRange: async (from: number, to: number) =>
      new Blob(Array.from({ length: to - from + 1 }, (_, k) => JSON.stringify({ line: from + k }))),
  };
}

interface Put {
  text: string;
  keepalive: boolean | undefined;
}

// Every held PUT is released after each test, so no save chain outlives its test
const transports: Array<{ release: () => void }> = [];

/** A transport whose PUTs stay pending until release() is called, like a request cut off by unload. */
function holdingTransport(): SidecarTransport & { puts: Put[]; release: () => void } {
  const waiting: Array<() => void> = [];
  const t = {
    puts: [] as Put[],
    get: async () => null,
    put: (text: string, opts?: { keepalive?: boolean }) => {
      t.puts.push({ text, keepalive: opts?.keepalive });
      return new Promise<{ ok: true }>((resolve) => waiting.push(() => resolve({ ok: true })));
    },
    release: () => {
      while (waiting.length) waiting.shift()!();
    },
  };
  transports.push(t);
  return t;
}

async function macrotasks(n = 20) {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
}

async function readIndexedDB(factory: IDBFactory, key: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const req = factory.open('evalcull', 1);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) return resolve(undefined);
      const get = db.transaction('sessions').objectStore('sessions').get(key);
      get.onsuccess = () => resolve(get.result as string | undefined);
      get.onerror = () => reject(get.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function loadAndDecide(lines: number, decided: number) {
  await useReviewStore.getState().load(createMockSource(lines), {
    sourceName: 'test.jsonl',
    fingerprint: 'lifecycle-fp',
    format: { kind: 'unknown' },
  });
  for (let i = 0; i < decided; i++) useReviewStore.getState().decide(String(i), 'kept');
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

beforeEach(() => {
  // Each test opens its file into an empty store, not over the previous test's file (DR-001 rule 3)
  resetStore();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  setVisibility('visible');
});

afterEach(async () => {
  vi.useRealTimers();
  for (const t of transports.splice(0)) t.release();
  await macrotasks();
  configureSidecar(null);
  setVisibility('visible');
  await macrotasks();
});

describe("pagehide (D-005)", () => {
  it('does not send a keepalive PUT for a session over the 65,536-byte quota (A)', async () => {
    configureStorage({ indexedDB: undefined });
    const transport = holdingTransport();
    configureSidecar({ token: 'tok', transport });
    // About 186 bytes per decision: 400 decisions is about 74 KB
    await loadAndDecide(500, 400);

    window.dispatchEvent(new Event('pagehide'));

    expect(transport.puts.length).toBe(1);
    expect(new TextEncoder().encode(transport.puts[0].text).length).toBeGreaterThan(KEEPALIVE_QUOTA);
    expect(transport.puts[0].keepalive).not.toBe(true);
  });

  it('sends a keepalive PUT for a session within the quota', async () => {
    configureStorage({ indexedDB: undefined });
    const transport = holdingTransport();
    configureSidecar({ token: 'tok', transport });
    await loadAndDecide(20, 3);

    window.dispatchEvent(new Event('pagehide'));

    expect(transport.puts.length).toBe(1);
    expect(transport.puts[0].keepalive).toBe(true);
  });

  it('keeps keepalive on the follow-up when a save is already in flight (F)', async () => {
    configureStorage({ indexedDB: undefined });
    const transport = holdingTransport();
    configureSidecar({ token: 'tok', transport });
    await loadAndDecide(20, 1);
    await vi.advanceTimersByTimeAsync(500); // the debounced save starts and its PUT is held
    expect(transport.puts.length).toBe(1);

    useReviewStore.getState().decide('1', 'kept'); // dirty again while the first PUT is in flight
    window.dispatchEvent(new Event('pagehide'));
    transport.release();
    await macrotasks();

    expect(transport.puts.length).toBe(2);
    expect(transport.puts[1].keepalive).toBe(true);
    expect(transport.puts[1].text).toContain('"1": {');
  });
});

describe('IndexedDB before the sidecar PUT in the lifecycle flushes (D-005 B)', () => {
  it('visibilitychange to hidden writes IndexedDB while the sidecar PUT is still pending', async () => {
    const factory = new IDBFactory();
    configureStorage({ indexedDB: factory });
    const transport = holdingTransport();
    configureSidecar({ token: 'tok', transport });
    await loadAndDecide(20, 2);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await macrotasks();

    expect(transport.puts.length).toBe(1); // held, as if cut off by unload
    expect(await readIndexedDB(factory, 'lifecycle-fp')).toBe(transport.puts[0].text);
  });

  it('pagehide writes IndexedDB while the sidecar PUT is still pending', async () => {
    const factory = new IDBFactory();
    configureStorage({ indexedDB: factory });
    const transport = holdingTransport();
    configureSidecar({ token: 'tok', transport });
    await loadAndDecide(20, 2);

    window.dispatchEvent(new Event('pagehide'));
    await macrotasks();

    expect(transport.puts.length).toBe(1);
    expect(await readIndexedDB(factory, 'lifecycle-fp')).toBe(transport.puts[0].text);
  });
});

describe('beforeunload while a save is pending (D-005 G)', () => {
  function beforeUnload(): Event {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  it('asks to confirm closing while a save is pending or in flight, and not once it is saved', async () => {
    configureStorage({ indexedDB: undefined });
    const transport = holdingTransport();
    configureSidecar({ token: 'tok', transport });
    await loadAndDecide(20, 0);
    expect(beforeUnload().defaultPrevented).toBe(false);

    useReviewStore.getState().decide('0', 'kept'); // debounce pending
    expect(beforeUnload().defaultPrevented).toBe(true);

    await vi.advanceTimersByTimeAsync(500); // PUT in flight
    expect(transport.puts.length).toBe(1);
    expect(beforeUnload().defaultPrevented).toBe(true);

    transport.release();
    await macrotasks();
    expect(useReviewStore.getState().storageState).toEqual({ kind: 'saved' });
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it('removes its listener once saved, so the back/forward cache is unaffected', async () => {
    configureStorage({ indexedDB: undefined });
    const transport = holdingTransport();
    configureSidecar({ token: 'tok', transport });
    await loadAndDecide(20, 0);
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');

    useReviewStore.getState().decide('0', 'kept');
    await vi.advanceTimersByTimeAsync(500);
    transport.release();
    await macrotasks();

    const addedHandlers = added.mock.calls.filter((c) => c[0] === 'beforeunload').map((c) => c[1]);
    const removedHandlers = removed.mock.calls.filter((c) => c[0] === 'beforeunload').map((c) => c[1]);
    expect(addedHandlers.length).toBe(1);
    expect(removedHandlers).toEqual(addedHandlers);
    added.mockRestore();
    removed.mockRestore();
  });
});

describe('a save made when the tab is hidden counts for the switch (D-057)', () => {
  it('a switch after a visibility-hidden save that reached the sidecar opens the new file', async () => {
    configureStorage({ indexedDB: undefined });
    configureSidecar({
      token: 'tok',
      transport: { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue({ ok: true }) },
    });
    await loadAndDecide(3, 1);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await macrotasks();
    setVisibility('visible');

    await useReviewStore.getState().load(createMockSource(3), {
      sourceName: 'b.jsonl',
      fingerprint: 'lifecycle-b',
      format: { kind: 'unknown' },
    });

    expect(useReviewStore.getState().fingerprint).toBe('lifecycle-b');
  });
});

describe('the unsaved mark and a flush behind a save in flight (D-063)', () => {
  it('a change carried only by a flush that failed still holds the switch', async () => {
    configureStorage({ indexedDB: undefined });
    let release: (r: { ok: true }) => void = () => {};
    let putCount = 0;
    configureSidecar({
      token: 'tok',
      transport: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockImplementation(() => {
          putCount++;
          // The first PUT is held; the flush's PUT behind it is refused
          return putCount === 1
            ? new Promise((resolve) => {
                release = resolve;
              })
            : Promise.resolve({ ok: false, status: 500, message: 'boom' });
        }),
      },
    });
    await loadAndDecide(3, 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(putCount).toBe(1);

    // A second change, then the tab is hidden: the flush waits behind the PUT in flight
    useReviewStore.getState().decide('1', 'rejected');
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    release({ ok: true });
    await macrotasks();
    expect(putCount).toBe(2);

    await useReviewStore.getState().load(createMockSource(3), {
      sourceName: 'b.jsonl',
      fingerprint: 'lifecycle-b',
      format: { kind: 'unknown' },
    });

    expect(useReviewStore.getState().fingerprint).toBe('lifecycle-fp');
  });
});
