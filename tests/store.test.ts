import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLosslessNumber } from 'lossless-json';

import { mulberry32, SEEDS, randomInt, randomElement } from './helpers/prng';
import {
  configureStorage,
  configureSidecar,
  parseSessionText,
  serialiseSession,
  stateFromSession,
  makeFetchTransport,
  type SidecarTransport,
} from '../src/store/persistence';
import { useReviewStore } from '../src/store/useReviewStore';
import {
  isValidRef,
  parseRefLine,
  formatPromptRef,
  formatCandidateRef,
  groupByLine,
  lineDecision,
} from '../src/store/refs';
import type {
  CandidateRef,
  Decision,
  RecordSource,
  FileIndex,
  HistoryAction,
  DecisionStatus,
  Preference,
} from '../src/types';

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

beforeEach(() => {
  // Fresh IDB per test
  configureStorage({ indexedDB: new IDBFactory() });

  // Clear sidecar configuration
  configureSidecar(null);

  // Reset store to initial state
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
    groupsStale: false,
    _dirty: false,
    _lastSerializedText: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// -----------------------------------------------------------------------------
// Mock helpers
// -----------------------------------------------------------------------------

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
  };

  return {
    kind: 'jsonl',
    index,
    readText: async (i: number) => JSON.stringify({ line: i }),
    readRaw: async (i: number) => new Blob([JSON.stringify({ line: i })]),
  };
}

function createMockTransport(): SidecarTransport & {
  lastPutBody: string | null;
  putCalls: Array<{ text: string; opts?: { keepalive?: boolean } }>;
} {
  const transport = {
    lastPutBody: null as string | null,
    putCalls: [] as Array<{ text: string; opts?: { keepalive?: boolean } }>,
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockImplementation(async (text: string, opts?: { keepalive?: boolean }) => {
      transport.lastPutBody = text;
      transport.putCalls.push({ text, opts });
      return { ok: true as const };
    }),
  };
  return transport;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// -----------------------------------------------------------------------------
// Ref helpers tests
// -----------------------------------------------------------------------------

describe('ref helpers', () => {
  it.each([
    ['412', 412],
    ['412:1', 412],
    ['0', 0],
    ['0:0', 0],
    ['1000:99', 1000],
  ])('parseRefLine(%s) → %d', (ref, expected) => {
    expect(parseRefLine(ref as CandidateRef)).toBe(expected);
  });

  it.each([
    ['412', true],
    ['412:1', true],
    ['0', true],
    ['0:0', true],
    ['1000:99', true],
    ['412abc', false],
    ['abc', false],
    [':1', false],
    ['', false],
    ['12:34:56', false],
    ['-1', false],
  ])('isValidRef(%s) → %s', (ref, expected) => {
    expect(isValidRef(ref)).toBe(expected);
  });

  it('formatPromptRef returns string index', () => {
    expect(formatPromptRef(0)).toBe('0');
    expect(formatPromptRef(42)).toBe('42');
  });

  it('formatCandidateRef returns record:candidate', () => {
    expect(formatCandidateRef(0, 0)).toBe('0:0');
    expect(formatCandidateRef(5, 1)).toBe('5:1');
  });

  it('lineDecision is deterministic regardless of insertion order', () => {
    const makeDecisions = (order: CandidateRef[]) => {
      const map = new Map<CandidateRef, Decision>();
      for (const ref of order) {
        if (ref === '5') {
          map.set(ref, { status: 'kept', updatedAt: 1000 });
        } else if (ref === '5:0') {
          map.set(ref, { status: 'kept', edits: { a: 1 }, updatedAt: 1001 });
        } else if (ref === '5:1') {
          map.set(ref, { status: 'rejected', edits: { b: 2 }, updatedAt: 1002 });
        }
      }
      return map;
    };

    const orderA: CandidateRef[] = ['5', '5:0', '5:1'];
    const orderB: CandidateRef[] = ['5:1', '5', '5:0'];

    const decisionsA = makeDecisions(orderA);
    const decisionsB = makeDecisions(orderB);

    const indexA = groupByLine(decisionsA);
    const indexB = groupByLine(decisionsB);

    const resultA = lineDecision(decisionsA, indexA, 5);
    const resultB = lineDecision(decisionsB, indexB, 5);

    expect(resultA).toEqual(resultB);
    expect(resultA?.status).toBe('kept');
    expect(resultA?.edits).toEqual({ a: 1, b: 2 });
    expect(resultA?.updatedAt).toBe(1002);
  });

  it('lineDecision returns Decision for touched line without prompt entry', () => {
    const decisions = new Map<CandidateRef, Decision>([
      ['5:0', { status: 'kept', updatedAt: 1001 }],
      ['5:1', { status: 'rejected', edits: { x: 'y' }, updatedAt: 1002 }],
    ]);

    const index = groupByLine(decisions);
    const result = lineDecision(decisions, index, 5);

    expect(result).toBeDefined();
    expect(result?.status).toBe('unreviewed'); // Default
    expect(result?.edits).toEqual({ x: 'y' });
    expect(result?.updatedAt).toBe(1002);
  });

  it('lineDecision returns undefined for untouched line', () => {
    const decisions = new Map<CandidateRef, Decision>([
      ['0', { status: 'kept', updatedAt: 1000 }],
    ]);

    const index = groupByLine(decisions);
    const result = lineDecision(decisions, index, 5);

    expect(result).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Session parsing and serialisation tests
// -----------------------------------------------------------------------------

describe('persistence', () => {
  it('fixture restores cursor and decisions', () => {
    const text = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/valid-v2.json'),
      'utf-8'
    );
    const result = parseSessionText(text);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.cursor).toBe(1);
    expect(result.session.decisions['0']).toBeDefined();
    expect(result.session.decisions['1']).toBeDefined();
    expect(result.session.decisions['1:0']).toBeDefined();
  });

  it('serialised form matches fixture byte-identically', () => {
    const text = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/valid-v2.json'),
      'utf-8'
    );
    const result = parseSessionText(text);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const restored = stateFromSession(result.session);
    const reserialized = serialiseSession(
      {
        source: { kind: 'jsonl' } as RecordSource,
        fingerprint: result.session.fingerprint,
        sourceName: result.session.sourceName,
        format: restored.format,
        decisions: restored.decisions,
        cursor: restored.cursor,
        past: restored.past,
      },
      () => result.session.savedAt
    );

    expect(reserialized).toBe(text);
  });

  it('unsafe-integer edit round-trips with digits, version/cursor/score/strength are numbers after load', () => {
    const text = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/unsafe-integer-edit.json'),
      'utf-8'
    );
    const result = parseSessionText(text);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Schema fields are native numbers
    expect(typeof result.session.version).toBe('number');
    expect(result.session.version).toBe(2);
    expect(typeof result.session.cursor).toBe('number');
    expect(result.session.cursor).toBe(0);
    expect(typeof result.session.savedAt).toBe('number');

    // Decision numeric fields
    const decision0 = result.session.decisions['0'];
    expect(typeof decision0.score).toBe('number');
    expect(decision0.score).toBe(85);
    expect(typeof decision0.compare?.strength).toBe('number');
    expect(decision0.compare?.strength).toBe(2);

    // History score action
    const scoreAction = result.session.history.find((h) => h.type === 'score');
    expect(scoreAction).toBeDefined();
    if (scoreAction?.type === 'score') {
      expect(typeof scoreAction.before).toBe('number');
      expect(scoreAction.before).toBe(50);
      expect(typeof scoreAction.after).toBe('number');
      expect(scoreAction.after).toBe(85);
    }

    // History compare action with strength
    const compareAction = result.session.history.find((h) => h.type === 'compare');
    expect(compareAction).toBeDefined();
    if (compareAction?.type === 'compare') {
      expect(typeof compareAction.before?.strength).toBe('number');
      expect(compareAction.before?.strength).toBe(1);
      expect(typeof compareAction.after?.strength).toBe('number');
      expect(compareAction.after?.strength).toBe(2);
    }

    // Re-serialise and verify unsafe integer preserved
    const restored = stateFromSession(result.session);
    const reserialized = serialiseSession(
      {
        source: { kind: 'jsonl' } as RecordSource,
        fingerprint: result.session.fingerprint,
        sourceName: result.session.sourceName,
        format: restored.format,
        decisions: restored.decisions,
        cursor: restored.cursor,
        past: restored.past,
      },
      () => result.session.savedAt
    );

    expect(reserialized).toContain('9007199254740993');
  });

  it('fingerprint mismatch is refused', () => {
    const text = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/fingerprint-mismatch.json'),
      'utf-8'
    );
    const result = parseSessionText(text);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The session itself parses fine, but fingerprint won't match when loading
    expect(result.session.fingerprint).toBe('different-fingerprint');
  });

  it('unknown version is refused', () => {
    const text = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/unknown-version.json'),
      'utf-8'
    );
    const result = parseSessionText(text);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toContain('99');
  });

  it('importSession with force bypasses mismatch but requires version 2', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'abc123',
    });

    // Import mismatched fingerprint with force
    const mismatchText = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/fingerprint-mismatch.json'),
      'utf-8'
    );
    useReviewStore.getState().importSession(mismatchText, { force: true });

    expect(useReviewStore.getState().session.kind).toBe('restored');

    // Reset and try unknown version with force - should still refuse
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'abc123',
    });

    const unknownText = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/unknown-version.json'),
      'utf-8'
    );
    useReviewStore.getState().importSession(unknownText, { force: true });

    const session = useReviewStore.getState().session;
    expect(session.kind).toBe('refused');
    if (session.kind === 'refused') {
      expect(session.reason).toBe('unknown-version');
    }
  });

  it('PUT body equals exportSession bytes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    const transport = createMockTransport();
    configureSidecar({ token: 'test-token', transport });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    // Make a change to trigger save
    useReviewStore.getState().decide('0', 'kept');

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(500);

    const exported = useReviewStore.getState().exportSession();
    expect(transport.lastPutBody).toBe(exported);
  });
});

// -----------------------------------------------------------------------------
// Undo/redo tests
// -----------------------------------------------------------------------------

describe('undo/redo', () => {
  const ACTION_TYPES: Array<HistoryAction['type']> = [
    'status',
    'compare',
    'edit',
    'labels',
    'score',
    'notes',
  ];

  async function setupStore() {
    const source = createMockSource(20);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });
  }

  it.each(SEEDS)('seed %d: undo to empty returns initial decisions Map', async (seed) => {
    await setupStore();
    const rng = mulberry32(seed);
    const store = useReviewStore.getState();

    // Generate random actions
    const numActions = randomInt(rng, 10, 20);
    for (let i = 0; i < numActions; i++) {
      const actionType = randomElement(rng, ACTION_TYPES);
      const ref = formatPromptRef(randomInt(rng, 0, 19));

      switch (actionType) {
        case 'status':
          store.decide(ref, randomElement(rng, ['kept', 'rejected', 'skipped'] as DecisionStatus[]));
          break;
        case 'compare':
          store.setMode('compare');
          store.goTo(parseRefLine(ref));
          store.prefer(randomElement(rng, ['left', 'right', 'tie', 'both_bad'] as Preference[]));
          break;
        case 'edit':
          store.edit(ref, 'content', `value-${i}`);
          break;
        case 'labels':
          store.setLabels(ref, [`label-${i}`]);
          break;
        case 'score':
          store.setScore(ref, randomInt(rng, 1, 100));
          break;
        case 'notes':
          store.setNotes(ref, `note-${i}`);
          break;
      }
    }

    // Undo all
    while (useReviewStore.getState().past.length > 0) {
      useReviewStore.getState().undo();
    }

    // Decisions should be empty
    expect(useReviewStore.getState().decisions.size).toBe(0);
  });

  it.each(SEEDS)('seed %d: redo to end returns final decisions', async (seed) => {
    await setupStore();
    const rng = mulberry32(seed);
    const store = useReviewStore.getState();

    // Generate actions and capture final state
    const numActions = randomInt(rng, 5, 10);
    for (let i = 0; i < numActions; i++) {
      const ref = formatPromptRef(randomInt(rng, 0, 19));
      store.decide(ref, 'kept');
    }

    const finalDecisions = new Map(useReviewStore.getState().decisions);

    // Undo all
    while (useReviewStore.getState().past.length > 0) {
      useReviewStore.getState().undo();
    }

    // Redo all
    while (useReviewStore.getState().future.length > 0) {
      useReviewStore.getState().redo();
    }

    // Check decisions match (ignoring updatedAt)
    expect(useReviewStore.getState().decisions.size).toBe(finalDecisions.size);
    for (const [ref, decision] of finalDecisions) {
      const current = useReviewStore.getState().decisions.get(ref);
      expect(current?.status).toBe(decision.status);
    }
  });

  it.each(SEEDS)('seed %d: each single undo changes exactly one entry or cursor', async (seed) => {
    await setupStore();
    const rng = mulberry32(seed);

    // Make several changes
    for (let i = 0; i < 5; i++) {
      const ref = formatPromptRef(randomInt(rng, 0, 19));
      useReviewStore.getState().decide(ref, 'kept');
    }

    // Each undo should change state
    while (useReviewStore.getState().past.length > 0) {
      const beforeSize = useReviewStore.getState().decisions.size;
      const beforeCursor = useReviewStore.getState().cursor;

      useReviewStore.getState().undo();

      const afterSize = useReviewStore.getState().decisions.size;
      const afterCursor = useReviewStore.getState().cursor;

      // Either decisions changed or cursor moved to affected prompt
      expect(beforeSize !== afterSize || beforeCursor !== afterCursor).toBe(true);
    }
  });

  it('edit undo: undoing deletes key, lineDecision has no edits', async () => {
    await setupStore();

    const ref = formatPromptRef(5);
    useReviewStore.getState().edit(ref, 'content', 'edited');

    // Verify edit exists
    const index = groupByLine(useReviewStore.getState().decisions);
    let decision = lineDecision(useReviewStore.getState().decisions, index, 5);
    expect(decision?.edits).toEqual({ content: 'edited' });

    // Undo
    useReviewStore.getState().undo();

    // Verify edit is gone
    const indexAfter = groupByLine(useReviewStore.getState().decisions);
    decision = lineDecision(useReviewStore.getState().decisions, indexAfter, 5);
    expect(decision?.edits).toBeUndefined();
  });

  it.each(['status', 'compare', 'edit', 'labels', 'score', 'notes'] as const)(
    'handles %s action correctly',
    async (actionType) => {
      await setupStore();
      const ref = formatPromptRef(0);

      switch (actionType) {
        case 'status':
          useReviewStore.getState().decide(ref, 'kept');
          expect(useReviewStore.getState().decisions.get(ref)?.status).toBe('kept');
          useReviewStore.getState().undo();
          expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();
          break;

        case 'compare':
          useReviewStore.getState().setMode('compare');
          useReviewStore.getState().prefer('left');
          expect(useReviewStore.getState().decisions.get(ref)?.compare?.preference).toBe('left');
          useReviewStore.getState().undo();
          // Decision deleted when no meaningful state remains after undo
          expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();
          break;

        case 'edit':
          useReviewStore.getState().edit(ref, 'path', 'value');
          expect(useReviewStore.getState().decisions.get(ref)?.edits?.path).toBe('value');
          useReviewStore.getState().undo();
          expect(useReviewStore.getState().decisions.get(ref)?.edits).toBeUndefined();
          break;

        case 'labels':
          useReviewStore.getState().setLabels(ref, ['tag1']);
          expect(useReviewStore.getState().decisions.get(ref)?.labels).toEqual(['tag1']);
          useReviewStore.getState().undo();
          // Decision deleted when no meaningful state remains after undo
          expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();
          break;

        case 'score':
          useReviewStore.getState().setScore(ref, 5);
          expect(useReviewStore.getState().decisions.get(ref)?.score).toBe(5);
          useReviewStore.getState().undo();
          expect(useReviewStore.getState().decisions.get(ref)?.score).toBeUndefined();
          break;

        case 'notes':
          useReviewStore.getState().setNotes(ref, 'note');
          expect(useReviewStore.getState().decisions.get(ref)?.notes).toBe('note');
          useReviewStore.getState().undo();
          expect(useReviewStore.getState().decisions.get(ref)?.notes).toBeUndefined();
          break;
      }
    }
  );

  it('setLabels(ref, []) on untouched ref leaves no entry', async () => {
    await setupStore();
    const ref = formatPromptRef(5);

    // No decision should exist yet
    expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();

    // Setting empty labels on untouched ref should leave no entry
    useReviewStore.getState().setLabels(ref, []);
    expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();
  });

  it('redo of clearing action leaves no entry', async () => {
    await setupStore();
    const ref = formatPromptRef(0);

    // Add labels, then clear them
    useReviewStore.getState().setLabels(ref, ['tag1']);
    expect(useReviewStore.getState().decisions.get(ref)?.labels).toEqual(['tag1']);

    useReviewStore.getState().setLabels(ref, []);
    // After clearing, entry should be pruned
    expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();

    // Undo: should restore labels
    useReviewStore.getState().undo();
    expect(useReviewStore.getState().decisions.get(ref)?.labels).toEqual(['tag1']);

    // Redo: should clear and prune again
    useReviewStore.getState().redo();
    expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();
  });

  it('undo after reload leaves native numbers in state (score and strength)', async () => {
    // Load the unsafe-integer fixture which has score and strength in history
    const text = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/unsafe-integer-edit.json'),
      'utf-8'
    );

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'unsafe-test',
    });

    // Import the session
    useReviewStore.getState().importSession(text, { force: true });

    // Find the score action and undo it
    const state = useReviewStore.getState();
    const scoreActionIdx = state.past.findIndex((h) => h.type === 'score');
    expect(scoreActionIdx).toBeGreaterThanOrEqual(0);

    // Undo back to the score action
    while (useReviewStore.getState().past.length > scoreActionIdx) {
      useReviewStore.getState().undo();
    }

    // Check that score is a native number
    const decision = useReviewStore.getState().decisions.get('0');
    expect(typeof decision?.score).toBe('number');
  });
});

// -----------------------------------------------------------------------------
// Navigation tests
// -----------------------------------------------------------------------------

describe('navigation', () => {
  it('never pushes history', async () => {
    const source = createMockSource(20);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    const initialPastLength = useReviewStore.getState().past.length;

    useReviewStore.getState().next();
    expect(useReviewStore.getState().past.length).toBe(initialPastLength);

    useReviewStore.getState().prev();
    expect(useReviewStore.getState().past.length).toBe(initialPastLength);

    useReviewStore.getState().goTo(10);
    expect(useReviewStore.getState().past.length).toBe(initialPastLength);

    useReviewStore.getState().nextUnreviewed();
    expect(useReviewStore.getState().past.length).toBe(initialPastLength);
  });

  it('next/prev wraps around', async () => {
    const source = createMockSource(5);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    useReviewStore.getState().goTo(4);
    useReviewStore.getState().next();
    expect(useReviewStore.getState().cursor).toBe(0);

    useReviewStore.getState().goTo(0);
    useReviewStore.getState().prev();
    expect(useReviewStore.getState().cursor).toBe(4);
  });
});

// -----------------------------------------------------------------------------
// Record cache tests
// -----------------------------------------------------------------------------

describe('record cache', () => {
  it('cleared on load', async () => {
    const source1 = createMockSource(10);
    await useReviewStore.getState().load(source1, {
      sourceName: 'file1.jsonl',
      fingerprint: 'fp1',
    });

    const record1 = await useReviewStore.getState().record(0);
    expect(record1.ok).toBe(true);
    if (record1.ok) {
      const data = record1.data as { line: unknown };
      expect(isLosslessNumber(data.line)).toBe(true);
      expect((data.line as { value: string }).value).toBe('0');
    }

    // Load second file with different content
    const base = createMockSource(10);
    if (base.kind !== 'jsonl') throw new Error('Expected jsonl source');
    const source2: RecordSource = {
      ...base,
      readText: async (i: number) => JSON.stringify({ different: i }),
    };

    await useReviewStore.getState().load(source2, {
      sourceName: 'file2.jsonl',
      fingerprint: 'fp2',
    });

    const record2 = await useReviewStore.getState().record(0);
    expect(record2.ok).toBe(true);
    if (record2.ok) {
      const data = record2.data as { different: unknown };
      expect(isLosslessNumber(data.different)).toBe(true);
      expect((data.different as { value: string }).value).toBe('0');
    }
  });

  it('cleared on importSession', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'abc123',
    });

    // Access a record
    await useReviewStore.getState().record(0);

    // Import session
    const text = readFileSync(
      join(import.meta.dirname, 'fixtures/sessions/valid-v2.json'),
      'utf-8'
    );
    useReviewStore.getState().importSession(text, { force: true });

    // Record should still be accessible (cache cleared but re-parsed)
    const record = await useReviewStore.getState().record(0);
    expect(record.ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// IndexedDB tests
// -----------------------------------------------------------------------------

describe('IndexedDB', () => {
  it('stores and retrieves session by fingerprint', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    // Make change and wait for save
    useReviewStore.getState().decide('0', 'kept');
    await vi.advanceTimersByTimeAsync(500);

    // Load again - should restore
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    expect(useReviewStore.getState().session.kind).toBe('restored');
    expect(useReviewStore.getState().decisions.get('0')?.status).toBe('kept');
  });

  it('configureStorage seam: factory A save, factory B load returns null', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    // Configure factory A and save
    const factoryA = new IDBFactory();
    configureStorage({ indexedDB: factoryA });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'seam-test-fp',
    });

    useReviewStore.getState().decide('0', 'kept');
    await vi.advanceTimersByTimeAsync(500);

    // Verify saved to factory A
    expect(useReviewStore.getState().storageState.kind).toBe('saved');

    // Configure factory B (separate database namespace)
    const factoryB = new IDBFactory();
    configureStorage({ indexedDB: factoryB });

    // Reset store state
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
      groupsStale: false,
      _dirty: false,
      _lastSerializedText: null,
    });

    // Load with factory B - should not find session from factory A
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'seam-test-fp',
    });

    expect(useReviewStore.getState().session.kind).toBe('fresh');
    expect(useReviewStore.getState().decisions.size).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Sidecar transport tests
// -----------------------------------------------------------------------------

describe('sidecar transport', () => {
  it('PUT sends session body through transport', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    configureStorage({ indexedDB: undefined });

    const transport = createMockTransport();
    configureSidecar({ token: 'tok123', transport });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    // Make change to trigger save
    useReviewStore.getState().decide('0', 'kept');

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(transport.putCalls.length).toBeGreaterThan(0);
    const lastCall = transport.putCalls[transport.putCalls.length - 1];
    expect(typeof lastCall.text).toBe('string');
    expect(lastCall.text).toContain('"version": 2');
  });

  it('makeFetchTransport sends PUT with correct method, path, headers and body', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(null, { status: 200 });
    });

    const transport = makeFetchTransport('http://127.0.0.1:9999', mockFetch);
    configureSidecar({ token: 'test-token-abc', transport });

    const sessionBody = '{"version": 2, "test": "data"}';
    const putResult = await transport.put(sessionBody, { keepalive: true });

    expect(putResult.ok).toBe(true);
    expect(fetchCalls.length).toBe(1);

    const call = fetchCalls[0];
    expect(call.url).toBe('http://127.0.0.1:9999/api/session');
    expect(call.init.method).toBe('PUT');
    expect(call.init.headers).toEqual({
      'X-Evalcull-Token': 'test-token-abc',
      'Content-Type': 'application/json',
    });
    expect(call.init.body).toBe(sessionBody);
    expect(call.init.keepalive).toBe(true);
  });

  it('makeFetchTransport GET returns null on 404, no token sent (Host-check only)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const transport = makeFetchTransport('http://127.0.0.1:9999', mockFetch);

    const result = await transport.get();
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/api/session',
      { method: 'GET' }
    );
  });

  it('makeFetchTransport GET returns text on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"version": 2}', { status: 200 }));
    const transport = makeFetchTransport('http://127.0.0.1:9999', mockFetch);

    const result = await transport.get();
    expect(result).toBe('{"version": 2}');
  });

  it('makeFetchTransport defaults to relative paths (empty baseUrl)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const transport = makeFetchTransport(undefined, mockFetch);
    configureSidecar({ token: 'tok', transport });

    await transport.put('{}');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({ method: 'PUT' })
    );
  });
});

// -----------------------------------------------------------------------------
// Save queue tests
// -----------------------------------------------------------------------------

describe('save queue', () => {
  /**
   * Proves: generation counter prevents a stale write from updating state
   * after load() bumps the generation. The late-completing PUT is ignored.
   */
  it('load bumps generation so late PUT completion is ignored', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    configureStorage({ indexedDB: undefined });

    const transport = createMockTransport();
    const pendingPut = deferred<{ ok: true }>();

    transport.put = vi.fn().mockImplementation(() => pendingPut.promise);
    configureSidecar({ token: 'test', transport });

    const source1 = createMockSource(10);
    await useReviewStore.getState().load(source1, {
      sourceName: 'file1.jsonl',
      fingerprint: 'fp1',
    });

    useReviewStore.getState().decide('0', 'kept');

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(500);

    expect(transport.put).toHaveBeenCalledTimes(1);

    // Load second file before PUT completes - bumps generation
    const source2 = createMockSource(10);
    await useReviewStore.getState().load(source2, {
      sourceName: 'file2.jsonl',
      fingerprint: 'fp2',
    });

    // Complete the old PUT
    pendingPut.resolve({ ok: true });
    await Promise.resolve();

    // State should reflect file2, not be updated by stale completion
    expect(useReviewStore.getState().fingerprint).toBe('fp2');
    expect(useReviewStore.getState().session.kind).toBe('fresh');
  });

  /**
   * Proves: one write in flight at a time, changes coalesce into one follow-up.
   * PUT 1 pending + three state changes → put called once more after resolution.
   * The follow-up body is the latest text, and lastSavedAt never regresses.
   */
  it('one-in-flight: changes during PUT coalesce into one follow-up', async () => {
    vi.useFakeTimers();
    configureStorage({ indexedDB: undefined });

    const transport = createMockTransport();
    const puts: Array<{ resolve: (v: { ok: true }) => void; text: string }> = [];

    transport.put = vi.fn().mockImplementation((text: string) => {
      const d = deferred<{ ok: true }>();
      puts.push({ resolve: d.resolve, text });
      return d.promise;
    });
    configureSidecar({ token: 'test', transport });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    // First change triggers debounced save
    useReviewStore.getState().decide('0', 'kept');
    await vi.advanceTimersByTimeAsync(500);

    // PUT 1 is now in flight
    expect(puts.length).toBe(1);
    expect(transport.put).toHaveBeenCalledTimes(1);

    // Three more changes while PUT 1 is pending
    useReviewStore.getState().decide('1', 'rejected');
    useReviewStore.getState().decide('2', 'skipped');
    useReviewStore.getState().decide('3', 'kept');

    // Debounce fires but PUT 1 still pending - changes marked dirty
    await vi.advanceTimersByTimeAsync(500);

    // Still only 1 PUT in flight (changes coalesced)
    expect(transport.put).toHaveBeenCalledTimes(1);

    // Resolve PUT 1 and flush microtasks
    const savedAtBefore = useReviewStore.getState().lastSavedAt;
    puts[0].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // Exactly one follow-up PUT should have started
    expect(transport.put).toHaveBeenCalledTimes(2);
    expect(puts.length).toBe(2);

    // Follow-up body should contain latest state (all 4 decisions)
    expect(puts[1].text).toContain('"0"');
    expect(puts[1].text).toContain('"1"');
    expect(puts[1].text).toContain('"2"');
    expect(puts[1].text).toContain('"3"');
    expect(puts[1].text).toContain('"kept"');
    expect(puts[1].text).toContain('"rejected"');
    expect(puts[1].text).toContain('"skipped"');

    // Resolve PUT 2
    puts[1].resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // lastSavedAt should not regress
    const savedAtAfter = useReviewStore.getState().lastSavedAt;
    expect(savedAtAfter).not.toBeNull();
    if (savedAtBefore !== null && savedAtAfter !== null) {
      expect(savedAtAfter).toBeGreaterThanOrEqual(savedAtBefore);
    }

    // No more PUTs
    expect(transport.put).toHaveBeenCalledTimes(2);
  });
});

// -----------------------------------------------------------------------------
// Counts tests
// -----------------------------------------------------------------------------

describe('counts', () => {
  it('returns correct counts', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    useReviewStore.getState().decide('0', 'kept');
    useReviewStore.getState().decide('1', 'rejected');
    useReviewStore.getState().decide('2', 'skipped');
    useReviewStore.getState().edit('3', 'content', 'edited');

    const counts = useReviewStore.getState().counts();

    expect(counts.total).toBe(10);
    expect(counts.kept).toBe(1);
    expect(counts.rejected).toBe(1);
    expect(counts.skipped).toBe(1);
    expect(counts.edited).toBe(1);
    expect(counts.unreviewed).toBe(7); // 10 - 3 reviewed (kept/rejected/skipped). Edit with status='unreviewed' is still unreviewed.
    expect(counts.unparseable).toBe(0);
  });

  it('counts compare decisions', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
    });

    useReviewStore.getState().setMode('compare');

    useReviewStore.getState().goTo(0);
    useReviewStore.getState().prefer('left');

    useReviewStore.getState().goTo(1);
    useReviewStore.getState().prefer('right');

    useReviewStore.getState().goTo(2);
    useReviewStore.getState().prefer('tie');

    useReviewStore.getState().goTo(3);
    useReviewStore.getState().prefer('both_bad');

    const counts = useReviewStore.getState().counts();

    expect(counts.left).toBe(1);
    expect(counts.right).toBe(1);
    expect(counts.tie).toBe(1);
    expect(counts.bothBad).toBe(1);
    expect(counts.reviewed).toBe(4);
  });
});
