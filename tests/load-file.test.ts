/**
 * Loading a file whose saved session has another format (D-004).
 *
 * Oracle: the saved session's format, written by hand, and the fingerprint
 * computed with Node's own crypto. The reader is mocked so the test can see
 * which format the second pass was asked for and whether a regroup ran.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { FileIndex, RecordFormat, RecordSource } from '../src/types';

const reader = vi.hoisted(() => ({
  readJsonl: vi.fn(),
  regroup: vi.fn(),
}));

vi.mock('../src/readers/jsonl', () => ({ readJsonl: reader.readJsonl }));

import { loadJsonlFile } from '../src/readers/loadJsonlFile';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';

const LINES = ['{"prompt":"A","response":"1"}', '{"prompt":"B","response":"2"}'];
const SAVED_FORMAT: RecordFormat = { kind: 'flat', promptPath: 'prompt', responsePath: 'response' };
const DETECTED_FORMAT: RecordFormat = { kind: 'unknown' };

function makeSource(fingerprint: string): RecordSource {
  const index: FileIndex = {
    fingerprint,
    lineCount: 2,
    starts: Float64Array.from([0, 31]),
    ends: Float64Array.from([30, 61]),
    eols: new Uint8Array([1, 1]),
    hasBom: false,
    groups: Uint32Array.from([0, 1]),
    groupCount: 2,
    unparseable: new Uint32Array(0),
    candidates: Uint16Array.from([1, 1]),
  };
  return {
    kind: 'jsonl',
    index,
    readText: async (i: number) => LINES[i],
    readRaw: async (i: number) => new Blob([LINES[i] + '\n']),
    readRawRange: async (from: number, to: number) => new Blob(LINES.slice(from, to + 1).map((l) => l + '\n')),
  };
}

async function seedIndexedDB(factory: IDBFactory, fingerprint: string, text: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open('evalcull', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('sessions');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(text, fingerprint);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('loadJsonlFile', () => {
  beforeEach(() => {
    reader.readJsonl.mockReset();
    reader.regroup.mockReset();
    configureSidecar(null);
  });

  it("runs the second pass once, for the saved format, when the saved session differs from detection (D-004)", async () => {
    const file = new File([LINES.join('\n') + '\n'], 'data.jsonl', { lastModified: 1730505600000 });
    const fp = createHash('sha256')
      .update(`data.jsonl:${file.size}:1730505600000`)
      .digest('hex');

    const factory = new IDBFactory();
    await seedIndexedDB(
      factory,
      fp,
      JSON.stringify({
        version: 3,
        fingerprint: fp,
        sourceName: 'data.jsonl',
        sourceKind: 'jsonl',
        format: SAVED_FORMAT,
        decisions: {},
        cursor: 0,
        history: [],
        savedAt: 1730505610000,
      })
    );
    configureStorage({ indexedDB: factory });

    reader.regroup.mockResolvedValue({
      groups: Uint32Array.from([0, 1]),
      groupCount: 2,
      unparseable: new Uint32Array(0),
      candidates: Uint16Array.from([1, 1]),
    });
    // The real reader detects unless it is given a format
    reader.readJsonl.mockImplementation(
      async (_file: Blob, _name: string, _size: number, _mtime: number, options?: { format?: RecordFormat }) => ({
        source: makeSource(fp),
        format: options?.format ?? DETECTED_FORMAT,
        regroup: reader.regroup,
        dispose: () => {},
      })
    );

    await loadJsonlFile(file);

    expect(useReviewStore.getState().session.kind).toBe('restored');
    expect(reader.readJsonl).toHaveBeenCalledTimes(1);
    expect(reader.readJsonl.mock.calls[0][4]?.format).toEqual(SAVED_FORMAT);
    expect(reader.regroup).not.toHaveBeenCalled();
    expect(useReviewStore.getState().format).toEqual(SAVED_FORMAT);
  });
});
