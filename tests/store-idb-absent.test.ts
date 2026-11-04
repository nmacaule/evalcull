/**
 * Test store behavior when IndexedDB is unavailable.
 * NO fake-indexeddb/auto import - IndexedDB is undefined.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isLosslessNumber } from 'lossless-json';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import { useReviewStore } from '../src/store/useReviewStore';
import type { RecordSource, FileIndex } from '../src/types';

// Configure with undefined indexedDB
beforeEach(() => {
  configureStorage({ indexedDB: undefined });

  // Clear sidecar configuration
  configureSidecar(null);

  // Reset store
  useReviewStore.setState({
    source: null,
    sourceName: '',
    fingerprint: '',
    format: { kind: 'unknown' },
    decisions: new Map(),
    mode: 'single',
    cursor: 0,
    focus: 0,
    past: [],
    future: [],
    filter: 'all',
    storageState: { kind: 'idle' },
    lastSavedAt: null,
    session: { kind: 'fresh' },
    newerLocalCopy: null,
    _dirty: false,
    _lastSerializedText: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function createMockSource(lineCount: number): RecordSource {
  const groups = new Uint32Array(lineCount);
  for (let i = 0; i < lineCount; i++) groups[i] = i;

  const index: FileIndex = {
    fingerprint: 'test-fingerprint',
    lineCount,
    starts: new Float64Array(lineCount),
    ends: new Float64Array(lineCount),
    eols: new Uint8Array(lineCount),
    hasBom: false,
    groups,
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

describe('IndexedDB absent', () => {
  it('store still works, storageState shows unavailable after save attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });

    // Store loads successfully
    expect(useReviewStore.getState().session.kind).toBe('fresh');

    // Make a decision
    useReviewStore.getState().decide('0', 'kept');
    expect(useReviewStore.getState().decisions.get('0')?.status).toBe('kept');

    // Undo works
    useReviewStore.getState().undo();
    expect(useReviewStore.getState().decisions.get('0')).toBeUndefined();

    // Redo works
    useReviewStore.getState().redo();
    expect(useReviewStore.getState().decisions.get('0')?.status).toBe('kept');

    // Wait for save attempt
    await vi.advanceTimersByTimeAsync(500);

    // Storage should be unavailable (no sidecar configured, no IDB)
    expect(useReviewStore.getState().storageState.kind).toBe('unavailable');
  });

  it('navigation works', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });

    useReviewStore.getState().next();
    expect(useReviewStore.getState().cursor).toBe(1);

    useReviewStore.getState().prev();
    expect(useReviewStore.getState().cursor).toBe(0);

    useReviewStore.getState().goTo(5);
    expect(useReviewStore.getState().cursor).toBe(5);
  });

  it('record() works', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });

    const record = await useReviewStore.getState().record(0);
    expect(record.ok).toBe(true);
    if (record.ok) {
      const data = record.data as { line: unknown };
      expect(isLosslessNumber(data.line)).toBe(true);
      expect((data.line as { value: string }).value).toBe('0');
    }
  });

  it('exportSession works', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });

    useReviewStore.getState().decide('0', 'kept');

    const exported = useReviewStore.getState().exportSession();
    expect(exported).toContain('"version": 3');
    expect(exported).toContain('"kept"');
  });
});
