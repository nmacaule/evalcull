/**
 * Shared harness for App-level tests: a JSONL source over given lines, key
 * dispatch as tests.md asks, loading through the production load() seam, and a
 * store reset. Tests reach storage through configureStorage and the sidecar
 * through configureSidecar, as production code does.
 */

import { fireEvent } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { useReviewStore } from '../../src/store/useReviewStore';
import { configureStorage, configureSidecar, bumpSaveGeneration } from '../../src/store/persistence';
import type { FileIndex, RecordFormat, RecordSource } from '../../src/types';

export type JsonlSource = Extract<RecordSource, { kind: 'jsonl' }>;

/** A JSONL source over the given lines, each terminated by LF. */
export function makeSource(
  lines: string[],
  groups: number[],
  candidates: number[],
  opts: { fingerprint?: string; unparseable?: number[] } = {}
): JsonlSource {
  const starts = new Float64Array(lines.length);
  const ends = new Float64Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos;
    pos += new TextEncoder().encode(lines[i]).length;
    ends[i] = pos;
    pos += 1;
  }
  const index: FileIndex = {
    fingerprint: opts.fingerprint ?? 'test-fingerprint',
    lineCount: lines.length,
    starts,
    ends,
    eols: new Uint8Array(lines.length).fill(1),
    hasBom: false,
    groups: Uint32Array.from(groups),
    groupCount: new Set(groups).size,
    unparseable: Uint32Array.from(opts.unparseable ?? []),
    candidates: Uint16Array.from(candidates),
  };
  return {
    kind: 'jsonl',
    index,
    readText: async (i: number) => lines[i],
    readRaw: async (i: number) => new Blob([lines[i] + '\n']),
    readRawRange: async (from: number, to: number) =>
      new Blob(lines.slice(from, to + 1).map((l) => l + '\n')),
  };
}

/** Dispatch a key on the body with key, code and the real modifier flags. */
export function press(
  key: string,
  code: string,
  mods: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
  target: Element = document.body
): void {
  fireEvent.keyDown(target, {
    key,
    code,
    shiftKey: mods.shiftKey ?? false,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: false,
  });
}

/** Load a source through the production seam. */
export async function loadSource(source: JsonlSource, format: RecordFormat): Promise<void> {
  await useReviewStore.getState().load(source, {
    sourceName: 'test.jsonl',
    fingerprint: source.index.fingerprint,
    format,
  });
}

/** The card a ref names. */
export function card(container: HTMLElement, ref: string): HTMLElement {
  const el = container.querySelector(`[data-candidate-ref="${ref}"]`);
  if (!el) throw new Error(`No card for ref ${ref}`);
  return el as HTMLElement;
}

/** Fresh storage seams and an empty store. */
export function resetStore(): void {
  // A save scheduled by the previous test must not run against the emptied store
  bumpSaveGeneration();
  configureStorage({ indexedDB: new IDBFactory() });
  configureSidecar(null);
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
    _newerLocalCopyText: null,
    switching: { kind: 'idle' },
    cancelledSwitch: null,
    switchNotice: null,
    _switchReserved: false,
    _switchRunning: false,
    _heldSwitch: null,
    _changeSeq: 0,
    _sinkedSeq: 0,
    _exportedChangeSeq: -1,
    _dirty: false,
    _lastSerializedText: null,
  });
}

export const FLAT_IO: RecordFormat = { kind: 'flat', promptPath: 'instruction', responsePath: 'output' };

export const MESSAGES: RecordFormat = {
  kind: 'messages',
  path: 'messages',
  roleKey: 'role',
  contentKey: 'content',
  roles: { user: ['user'], assistant: ['assistant'], system: ['system'] },
};
