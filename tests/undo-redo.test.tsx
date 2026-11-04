/**
 * Undo/redo tests for WP 6a.
 * Oracle: WP 3 decision (c) - "undo and redo move the cursor to the affected prompt."
 * Tests that undo/redo operations move cursor to the line derived from the action's ref.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import { formatPromptRef, parseRefLine } from '../src/store/refs'; // single mode acts on line refs "i" (WP 6c)
import type { RecordSource, FileIndex, RecordFormat } from '../src/types';

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

function createMockSource(lineCount: number): RecordSource {
  const groups = new Uint32Array(lineCount);
  for (let i = 0; i < lineCount; i++) {
    groups[i] = i; // Each line is its own group for single mode tests
  }

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
    readText: async (i: number) => JSON.stringify({ instruction: `Prompt ${i}`, output: `Response ${i}` }),
    readRaw: async (i: number) => new Blob([JSON.stringify({ instruction: `Prompt ${i}`, output: `Response ${i}` })]),
    readRawRange: async (from: number, to: number) =>
      new Blob(Array.from({ length: to - from + 1 }, (_, k) => JSON.stringify({ instruction: `Prompt ${from + k}`, output: `Response ${from + k}` }))),
  };
}

const flatFormat: RecordFormat = {
  kind: 'flat',
  promptPath: 'instruction',
  responsePath: 'output',
};

beforeEach(() => {
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
    _dirty: false,
    _lastSerializedText: null,
  });
});


// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('undo/redo cursor movement', () => {
  describe('undo moves cursor to affected prompt', () => {
    it('undo moves cursor to the line of the undone action', () => {
      const source = createMockSource(10);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'single',
        cursor: 0,
      });

      // Make a decision at prompt 0
      const ref0 = formatPromptRef(0);
      useReviewStore.getState().decide(ref0, 'kept');

      // Decision auto-advances cursor; navigate further away
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      useReviewStore.getState().next();

      // Now at prompt 5
      expect(useReviewStore.getState().cursor).toBe(5);

      // Undo the decision at prompt 0
      useReviewStore.getState().undo();

      // Cursor should move to the affected line (0)
      const { cursor } = useReviewStore.getState();
      expect(cursor).toBe(0);
    });

    it('undo on middle prompt moves cursor there', () => {
      const source = createMockSource(10);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'single',
        cursor: 3, // Start at prompt 3
      });

      // Make a decision at prompt 3 (auto-advances to 4)
      const ref3 = formatPromptRef(3);
      useReviewStore.getState().decide(ref3, 'rejected');
      expect(useReviewStore.getState().cursor).toBe(4); // auto-advanced

      // Navigate away
      useReviewStore.getState().next(); // to 5
      useReviewStore.getState().next(); // to 6
      expect(useReviewStore.getState().cursor).toBe(6);

      // Undo
      useReviewStore.getState().undo();

      // Cursor should be at 3 (the affected prompt)
      expect(useReviewStore.getState().cursor).toBe(3);
    });

    it('multiple undos move cursor to each affected prompt in sequence', () => {
      const source = createMockSource(10);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'single',
        cursor: 0,
      });

      // Make decisions at prompts 0, 2, 4
      useReviewStore.getState().decide(formatPromptRef(0), 'kept');
      // Auto-advances to 1
      useReviewStore.getState().next(); // to 2
      useReviewStore.getState().decide(formatPromptRef(2), 'rejected');
      // Auto-advances to 3
      useReviewStore.getState().next(); // to 4
      useReviewStore.getState().decide(formatPromptRef(4), 'skipped');

      // Navigate to end
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      expect(useReviewStore.getState().cursor).toBe(8);

      // Undo last action (prompt 4)
      useReviewStore.getState().undo();
      expect(useReviewStore.getState().cursor).toBe(4);

      // Undo previous action (prompt 2)
      useReviewStore.getState().undo();
      expect(useReviewStore.getState().cursor).toBe(2);

      // Undo first action (prompt 0)
      useReviewStore.getState().undo();
      expect(useReviewStore.getState().cursor).toBe(0);
    });
  });

  describe('redo moves cursor to affected prompt', () => {
    it('redo moves cursor to the line of the redone action', () => {
      const source = createMockSource(10);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'single',
        cursor: 0,
      });

      // Make a decision and undo it
      const ref0 = formatPromptRef(0);
      useReviewStore.getState().decide(ref0, 'kept');
      useReviewStore.getState().undo();

      // Cursor is at 0 from undo
      expect(useReviewStore.getState().cursor).toBe(0);

      // Navigate away
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      expect(useReviewStore.getState().cursor).toBe(3);

      // Redo
      useReviewStore.getState().redo();

      // Cursor should move back to 0 where the action was redone
      expect(useReviewStore.getState().cursor).toBe(0);
    });

    it('redo after multiple undos restores cursor positions', () => {
      const source = createMockSource(10);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'single',
        cursor: 2,
      });

      // Make decisions
      useReviewStore.getState().decide(formatPromptRef(2), 'kept');
      useReviewStore.getState().next(); // to 4
      useReviewStore.getState().decide(formatPromptRef(4), 'rejected');

      // Undo both
      useReviewStore.getState().undo(); // undoes 4
      useReviewStore.getState().undo(); // undoes 2

      expect(useReviewStore.getState().cursor).toBe(2);

      // Redo first
      useReviewStore.getState().redo();
      expect(useReviewStore.getState().cursor).toBe(2);

      // Redo second
      useReviewStore.getState().redo();
      expect(useReviewStore.getState().cursor).toBe(4);
    });
  });

  describe('edit undo/redo cursor movement', () => {
    it('undo edit moves cursor to edited line', () => {
      const source = createMockSource(10);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'single',
        cursor: 3,
      });

      // Make an edit at prompt 3
      const ref3 = formatPromptRef(3);
      useReviewStore.getState().edit(ref3, 'output', 'Edited value');

      // Navigate away
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      expect(useReviewStore.getState().cursor).toBe(6);

      // Undo edit
      useReviewStore.getState().undo();

      // Cursor should move to line 3
      expect(useReviewStore.getState().cursor).toBe(3);
    });

    it('redo edit moves cursor to edited line', () => {
      const source = createMockSource(10);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'single',
        cursor: 5,
      });

      // Make an edit and undo it
      const ref5 = formatPromptRef(5);
      useReviewStore.getState().edit(ref5, 'output', 'New value');
      useReviewStore.getState().undo();

      // Navigate away
      useReviewStore.getState().next();
      useReviewStore.getState().next();
      expect(useReviewStore.getState().cursor).toBe(7);

      // Redo
      useReviewStore.getState().redo();

      // Cursor should be at 5
      expect(useReviewStore.getState().cursor).toBe(5);
    });
  });

  describe('preference undo/redo in compare mode', () => {
    it('undo preference moves cursor to affected prompt', () => {
      // Create interleaved groups: line i → group (i % groupCount)
      // This ensures group index === first line of that group
      const lineCount = 10;
      const groupCount = 5;
      const groups = new Uint32Array(lineCount);
      for (let i = 0; i < lineCount; i++) {
        groups[i] = i % groupCount;
      }

      const source: RecordSource = {
        kind: 'jsonl',
        index: {
          fingerprint: 'test',
          lineCount,
          starts: new Float64Array(lineCount),
          ends: new Float64Array(lineCount),
          eols: new Uint8Array(lineCount),
          hasBom: false,
          groups,
          groupCount,
          unparseable: new Uint32Array(0),
          candidates: new Uint16Array(lineCount).fill(1),
        },
        readText: async (i: number) => JSON.stringify({ line: i }),
        readRaw: async (i: number) => new Blob([JSON.stringify({ line: i })]),
        readRawRange: async (from: number, to: number) =>
          new Blob(Array.from({ length: to - from + 1 }, (_, k) => JSON.stringify({ line: from + k }))),
      };

      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0, // Group 0
      });

      // Make a preference
      useReviewStore.getState().prefer('left');

      // Auto-advances to next group index (1)
      expect(useReviewStore.getState().cursor).toBe(1);

      // Navigate further
      useReviewStore.getState().next(); // to group 2
      useReviewStore.getState().next(); // to group 3
      expect(useReviewStore.getState().cursor).toBe(3);

      // Undo preference
      useReviewStore.getState().undo();

      // Cursor should be at group 0
      expect(useReviewStore.getState().cursor).toBe(0);
    });
  });

  describe('parseRefLine utility', () => {
    it('extracts line number from candidate ref', () => {
      expect(parseRefLine('0' as any)).toBe(0);
      expect(parseRefLine('0:0' as any)).toBe(0);
      expect(parseRefLine('5' as any)).toBe(5);
      expect(parseRefLine('5:1' as any)).toBe(5);
      expect(parseRefLine('123:99' as any)).toBe(123);
    });
  });
});
