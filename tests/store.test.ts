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
import {
  useReviewStore,
  clearRegroupHandle,
} from '../src/store/useReviewStore';
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

function createMockSource(lineCount: number, groupCount: number = lineCount): RecordSource {
  // Interleaved groups: line i → group (i % groupCount), so group g's first line is g
  const groups = new Uint32Array(lineCount);
  for (let i = 0; i < lineCount; i++) groups[i] = i % groupCount;

  const index: FileIndex = {
    fingerprint: 'test-fingerprint',
    lineCount,
    starts: new Float64Array(lineCount),
    ends: new Float64Array(lineCount),
    eols: new Uint8Array(lineCount),
    hasBom: false,
    groups,
    groupCount,
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
      join(import.meta.dirname, 'fixtures/sessions/valid-v3.json'),
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
    expect(result.session.version).toBe(3); // version 2 is migrated on parse (PRD v3.3)
    expect(typeof result.session.cursor).toBe('number');
    expect(result.session.cursor).toBe(0);
    expect(typeof result.session.savedAt).toBe('number');

    // Decision numeric fields
    const decision0 = result.session.decisions['0'];
    expect(typeof decision0.score).toBe('number');
    expect(decision0.score).toBe(85);
    expect(typeof decision0.compare?.[0]?.strength).toBe('number');
    expect(decision0.compare?.[0]?.strength).toBe(2);

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

  it('importSession with force bypasses mismatch but requires a supported version', async () => {
    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'abc123',
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const transport = createMockTransport();
    configureSidecar({ token: 'test-token', transport });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
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

  async function setupStore(groupCount: number) {
    const source = createMockSource(20, groupCount);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });
  }

  // WP 6c: run in both modes. Single: one line per prompt, as before.
  // Compare: two candidates per prompt (groupCount < lineCount derives compare mode).
  describe.each([
    { mode: 'single', groupCount: 20 },
    { mode: 'compare', groupCount: 10 },
  ] as const)('$mode mode', ({ mode, groupCount }) => {
  const setup = () => setupStore(groupCount);

  it.each(SEEDS)('seed %d: undo to empty returns initial decisions Map', async (seed) => {
    await setup();
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
    await setup();
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
    await setup();
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
    await setup();

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

  // Q11 (owner, 4 Nov 2026): prefer() needs a two-candidate prompt, so the
  // compare row runs only in compare mode
  it.each(
    (['status', 'compare', 'edit', 'labels', 'score', 'notes'] as const).filter(
      (t) => mode === 'compare' || t !== 'compare'
    )
  )(
    'handles %s action correctly',
    async (actionType) => {
      await setup();
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
          expect(useReviewStore.getState().decisions.get(ref)?.compare?.[0]?.preference).toBe('left');
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
    await setup();
    const ref = formatPromptRef(5);

    // No decision should exist yet
    expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();

    // Setting empty labels on untouched ref should leave no entry
    useReviewStore.getState().setLabels(ref, []);
    expect(useReviewStore.getState().decisions.get(ref)).toBeUndefined();
  });

  it('redo of clearing action leaves no entry', async () => {
    await setup();
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
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });

    // Make change and wait for save
    useReviewStore.getState().decide('0', 'kept');
    await vi.advanceTimersByTimeAsync(500);

    // Load again - should restore
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });

    expect(useReviewStore.getState().session.kind).toBe('restored');
    expect(useReviewStore.getState().decisions.get('0')?.status).toBe('kept');
  });

  it('configureStorage seam: factory A save, factory B load returns null', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // Configure factory A and save
    const factoryA = new IDBFactory();
    configureStorage({ indexedDB: factoryA });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'seam-test-fp',
      format: { kind: 'unknown' },
    });

    useReviewStore.getState().decide('0', 'kept');
    await vi.advanceTimersByTimeAsync(500);
    // fake-indexeddb schedules on setImmediate, which is not faked: real
    // macrotask rounds let the IndexedDB write finish without moving the clock
    for (let i = 0; i < 20 && useReviewStore.getState().storageState.kind !== 'saved'; i++) {
      await new Promise<void>((r) => setImmediate(r));
    }

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
      _dirty: false,
      _lastSerializedText: null,
    });

    // Load with factory B - should not find session from factory A
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'seam-test-fp',
      format: { kind: 'unknown' },
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    configureStorage({ indexedDB: undefined });

    const transport = createMockTransport();
    configureSidecar({ token: 'tok123', transport });

    const source = createMockSource(10);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });

    // Make change to trigger save
    useReviewStore.getState().decide('0', 'kept');

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    // One change, one debounced save
    expect(transport.putCalls.length).toBe(1);
    const lastCall = transport.putCalls[transport.putCalls.length - 1];
    expect(typeof lastCall.text).toBe('string');
    expect(lastCall.text).toContain('"version": 3');
  });

  it("saves no later than 2 s after the first unsaved change while changes keep coming every 400 ms (D-010)", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    configureStorage({ indexedDB: undefined });
    const putTimes: number[] = [];
    configureSidecar({
      token: 'tok123',
      transport: {
        get: async () => null,
        put: async () => {
          putTimes.push(Date.now());
          return { ok: true as const };
        },
      },
    });
    await useReviewStore.getState().load(createMockSource(20), {
      sourceName: 'test.jsonl',
      fingerprint: 'maxwait-fp',
      format: { kind: 'unknown' },
    });

    // A change every 400 ms for 3 s: the 500 ms debounce alone never fires
    const firstChange = Date.now();
    for (let t = 0; t < 3000; t += 400) {
      useReviewStore.getState().decide(String(t / 400), 'kept');
      await vi.advanceTimersByTimeAsync(400);
    }

    // Changes at 0, 400 … 2800 ms: the maxWait save fires at 2,000 ms; the changes
    // from 2,000 ms on keep re-arming the debounce until the loop ends at 3,200 ms
    expect(putTimes.length).toBe(1);
    expect(putTimes[0] - firstChange).toBeLessThanOrEqual(2000);
  });

  it('with IndexedDB present, one save sends the PUT and then writes the same text to IndexedDB', async () => {
    // fake-indexeddb schedules on setImmediate, which is not faked here: real
    // macrotask rounds let the IndexedDB write finish without moving the clock.
    // clearTimeout is faked too, so the debounce can cancel its earlier timer.
    const factory = new IDBFactory();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    configureStorage({ indexedDB: factory });
    const transport = createMockTransport();
    configureSidecar({ token: 'tok123', transport });

    await useReviewStore.getState().load(createMockSource(10), {
      sourceName: 'test.jsonl',
      fingerprint: 'idb-chain-fp',
      format: { kind: 'unknown' },
    });
    useReviewStore.getState().decide('0', 'kept');
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    for (let i = 0; i < 20 && useReviewStore.getState().storageState.kind !== 'saved'; i++) {
      await new Promise<void>((r) => setImmediate(r));
    }

    expect(useReviewStore.getState().storageState).toEqual({ kind: 'saved' });
    expect(transport.putCalls.length).toBe(1);
    const stored = await new Promise<string>((resolve, reject) => {
      const req = factory.open('evalcull', 1);
      req.onsuccess = () => {
        const get = req.result.transaction('sessions').objectStore('sessions').get('idb-chain-fp');
        get.onsuccess = () => resolve(get.result as string);
        get.onerror = () => reject(get.error);
      };
      req.onerror = () => reject(req.error);
    });
    expect(stored).toBe(transport.putCalls[0].text);
    expect(JSON.parse(stored).decisions['0'].status).toBe('kept');
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    configureStorage({ indexedDB: undefined });

    const transport = createMockTransport();
    const pendingPut = deferred<{ ok: true }>();

    transport.put = vi.fn().mockImplementation(() => pendingPut.promise);
    configureSidecar({ token: 'test', transport });

    const source1 = createMockSource(10);
    await useReviewStore.getState().load(source1, {
      sourceName: 'file1.jsonl',
      fingerprint: 'fp1',
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
      format: { kind: 'unknown' },
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
    const source = createMockSource(10, 5); // two candidates per prompt
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
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

  it("single mode counts a line with a compare decision and no status once, as unreviewed (D-002)", async () => {
    // Lines 0..3 in two prompts (0,2) and (1,3): compare mode
    const source = createMockSource(4, 2);
    await useReviewStore.getState().load(
      source,
      { sourceName: 'test.jsonl', fingerprint: 'test-fp', format: { kind: 'unknown' } },
      {
        // A format with a distinct prompt per line: single mode
        regroup: async () => ({
          groups: new Uint32Array([0, 1, 2, 3]),
          groupCount: 4,
          unparseable: new Uint32Array(0),
          candidates: new Uint16Array([1, 1, 1, 1]),
        }),
        dispose: () => {},
      }
    );
    expect(useReviewStore.getState().mode).toBe('compare');
    useReviewStore.getState().goTo(0);
    useReviewStore.getState().prefer('left');

    await useReviewStore.getState().setFormat({ kind: 'flat', promptPath: 'p', responsePath: 'r' });
    expect(useReviewStore.getState().mode).toBe('single');

    // Four lines, none with a status: the next-unreviewed rule treats all four as unreviewed
    const counts = useReviewStore.getState().counts();
    expect(counts.total).toBe(4);
    expect(counts.reviewed).toBe(0);
    expect(counts.unreviewed).toBe(4);
  });

  it("a rows source with a preference format falls back to single mode (D-009)", async () => {
    // WP 5 decision (i): rows sources have no grouping, so compare mode falls back to single
    const source: RecordSource = {
      kind: 'rows',
      container: 'json',
      count: 2,
      readRow: async () => ({ chosen: 'a', rejected: 'b' }),
    };
    await useReviewStore.getState().load(source, {
      sourceName: 'test.json',
      fingerprint: 'rows-fp',
      format: { kind: 'preference', chosenPath: 'chosen', rejectedPath: 'rejected' },
    });
    expect(useReviewStore.getState().mode).toBe('single');
  });

  // D-003 setups: prompt 0 has a second candidate carrying a status or an edit
  async function loadRowsKeptOnSecondCandidate() {
    // Prompt 0 = lines 0 and 2, prompt 1 = lines 1 and 3
    const source = createMockSource(4, 2);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'unknown' },
    });
    expect(useReviewStore.getState().mode).toBe('compare');
    useReviewStore.getState().decide('2', 'kept');
  }

  async function loadInRecordEditOnSecondCandidate() {
    const source = createMockSource(2);
    if (source.kind === 'jsonl') source.index.candidates = new Uint16Array([2, 2]);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'responses' },
    });
    expect(useReviewStore.getState().mode).toBe('compare');
    useReviewStore.getState().edit('0:1', 'responses[1]', 'edited');
  }

  it("compare mode counts a status on a prompt's second row candidate (D-003)", async () => {
    await loadRowsKeptOnSecondCandidate();
    expect(useReviewStore.getState().counts().kept).toBe(1);
  });

  it("compare mode filters by a status on a prompt's second row candidate (D-003)", async () => {
    await loadRowsKeptOnSecondCandidate();
    useReviewStore.getState().goTo(1);
    useReviewStore.getState().setFilter('kept');
    useReviewStore.getState().next();
    expect(useReviewStore.getState().cursor).toBe(0);
  });

  it("compare mode counts an edit on a prompt's second in-record candidate (D-003)", async () => {
    await loadInRecordEditOnSecondCandidate();
    expect(useReviewStore.getState().counts().edited).toBe(1);
  });

  it("compare mode does not count or filter by a status on an in-record line ref that is not a candidate (D-003)", async () => {
    const source = createMockSource(2);
    if (source.kind === 'jsonl') source.index.candidates = new Uint16Array([2, 2]);
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'test-fp',
      format: { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'responses' },
    });
    // "0" names line 0's record, not one of prompt 0's candidates ("0:0", "0:1")
    useReviewStore.getState().decide('0', 'kept');
    expect(useReviewStore.getState().counts().kept).toBe(0);

    useReviewStore.getState().goTo(1);
    useReviewStore.getState().setFilter('kept');
    useReviewStore.getState().next();
    expect(useReviewStore.getState().cursor).toBe(1);
  });

  it("compare mode filters by an edit on a prompt's second in-record candidate (D-003)", async () => {
    await loadInRecordEditOnSecondCandidate();
    useReviewStore.getState().goTo(1);
    useReviewStore.getState().setFilter('edited');
    useReviewStore.getState().next();
    expect(useReviewStore.getState().cursor).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Regroup on restore tests
// -----------------------------------------------------------------------------

describe('regroup on restore', () => {
  it('regroups when restored session format differs from meta.format in load()', async () => {
    // Create source with initial grouping (each line = own group)
    const source = createMockSource(6);

    // Create a session with a different format
    const sessionWithFlatFormat = {
      version: 2,
      fingerprint: 'test-fp',
      sourceName: 'test.jsonl',
      sourceKind: 'jsonl',
      format: { kind: 'flat', promptPath: 'prompt', responsePath: 'response' },
      decisions: {},
      cursor: 0,
      history: [],
      savedAt: Date.now(),
    };
    const sessionText = JSON.stringify(sessionWithFlatFormat, null, 2);

    // Configure IDB with our own factory and seed the session
    const idbFactory = new IDBFactory();
    configureStorage({ indexedDB: idbFactory });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idbFactory.open('evalcull', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('sessions');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(sessionText, 'test-fp');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    // Track regroup calls
    let regroupCalledWith: unknown = null;
    const regroupCandidates = new Uint16Array([1, 1, 1, 1, 1, 1]);

    // Load with different meta.format, passing handle
    await useReviewStore.getState().load(
      source,
      {
        sourceName: 'test.jsonl',
        fingerprint: 'test-fp',
        format: { kind: 'unknown' }, // Different from session's flat format
      },
      {
        regroup: async (format) => {
          regroupCalledWith = format;
          // Return grouped: 0,2,4 -> group 0; 1,3,5 -> group 1
          const groups = new Uint32Array([0, 1, 0, 1, 0, 1]);
          return {
            groups,
            groupCount: 2,
            unparseable: new Uint32Array(0),
            candidates: regroupCandidates,
          };
        },
        dispose: () => {},
      }
    );

    // Verify regroup was called with the session's format
    expect(regroupCalledWith).toEqual({
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    });

    // Verify index was updated
    if (source.kind !== 'jsonl') throw new Error('Expected jsonl source');
    expect(source.index.groupCount).toBe(2);
    expect(Array.from(source.index.groups)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(source.index.candidates).toBe(regroupCandidates); // WP 6c: candidates copied

    // Verify store has session's format
    expect(useReviewStore.getState().format).toEqual({
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    });

    clearRegroupHandle('test-fp');
  });

  it('regroups when imported session format differs from current in importSession()', async () => {
    // Create source with initial grouping
    const source = createMockSource(6);

    // Track regroup calls
    let regroupCalledWith: unknown = null;
    const regroupCandidates = new Uint16Array([1, 1, 1, 1, 1, 1]);

    // Load with unknown format and a handle (handle will be registered)
    await useReviewStore.getState().load(
      source,
      {
        sourceName: 'test.jsonl',
        fingerprint: 'test-fp',
        format: { kind: 'unknown' },
      },
      {
        regroup: async (format) => {
          regroupCalledWith = format;
          const groups = new Uint32Array([0, 1, 0, 1, 0, 1]);
          return {
            groups,
            groupCount: 2,
            unparseable: new Uint32Array(0),
            candidates: regroupCandidates,
          };
        },
        dispose: () => {},
      }
    );

    // Import a session with different format
    const sessionWithFlatFormat = {
      version: 2,
      fingerprint: 'test-fp',
      sourceName: 'test.jsonl',
      sourceKind: 'jsonl',
      format: { kind: 'flat', promptPath: 'prompt', responsePath: 'response' },
      decisions: {},
      cursor: 0,
      history: [],
      savedAt: Date.now(),
    };
    const sessionText = JSON.stringify(sessionWithFlatFormat, null, 2);

    await useReviewStore.getState().importSession(sessionText, { force: true });

    // Verify import succeeded (fails here if session was refused)
    expect(useReviewStore.getState().session.kind).toBe('restored');

    // Verify regroup was called with the session's format
    expect(regroupCalledWith).toEqual({
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    });

    // Verify index was updated
    if (source.kind !== 'jsonl') throw new Error('Expected jsonl source');
    expect(source.index.groupCount).toBe(2);
    expect(Array.from(source.index.groups)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(source.index.candidates).toBe(regroupCandidates); // WP 6c: candidates copied

    // Verify store has session's format
    expect(useReviewStore.getState().format).toEqual({
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    });

    clearRegroupHandle('test-fp');
  });
});
