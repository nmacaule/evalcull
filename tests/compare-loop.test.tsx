/**
 * Compare loop tests for WP 6a.
 * Tests that preference keys update the decisions map and cursor advances.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import { formatCandidateRef, formatPromptRef } from '../src/store/refs';
import type { RecordSource, FileIndex, RecordFormat } from '../src/types';

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

function createMockSource(lineCount: number, groupCount?: number): RecordSource {
  // Create interleaved groups: line i → group (i % groupCount)
  // This ensures group index === first line of that group
  const actualGroupCount = groupCount ?? lineCount;
  const groups = new Uint32Array(lineCount);
  for (let i = 0; i < lineCount; i++) {
    groups[i] = i % actualGroupCount;
  }

  const index: FileIndex = {
    fingerprint: 'test-fingerprint',
    lineCount,
    starts: new Float64Array(lineCount),
    ends: new Float64Array(lineCount),
    eols: new Uint8Array(lineCount),
    hasBom: false,
    groups,
    groupCount: actualGroupCount,
    unparseable: new Uint32Array(0),
  };

  return {
    kind: 'jsonl',
    index,
    readText: async (i: number) => JSON.stringify({ instruction: `Prompt ${groups[i]}`, output: `Response ${i}` }),
    readRaw: async (i: number) => new Blob([JSON.stringify({ instruction: `Prompt ${groups[i]}`, output: `Response ${i}` })]),
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

describe('compare loop', () => {
  describe('preference recording', () => {
    it('prefer("left") records preference on prompt ref', () => {
      const source = createMockSource(6); // 3 groups of 2
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0, // First group
      });

      const { prefer } = useReviewStore.getState();
      prefer('left');

      const decisions = useReviewStore.getState().decisions;
      const promptRef = formatPromptRef(0);
      const decision = decisions.get(promptRef);

      expect(decision).toBeDefined();
      expect(decision?.compare?.preference).toBe('left');
    });

    it('prefer("right") records preference', () => {
      const source = createMockSource(6);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 2, // Second group (lines 2,3)
      });

      const { prefer } = useReviewStore.getState();
      prefer('right');

      const decisions = useReviewStore.getState().decisions;
      const promptRef = formatPromptRef(2);
      const decision = decisions.get(promptRef);

      expect(decision?.compare?.preference).toBe('right');
    });

    it('prefer("tie") records tie preference', () => {
      const source = createMockSource(4);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
      });

      const { prefer } = useReviewStore.getState();
      prefer('tie');

      const decisions = useReviewStore.getState().decisions;
      const promptRef = formatPromptRef(0);

      expect(decisions.get(promptRef)?.compare?.preference).toBe('tie');
    });

    it('prefer("both_bad") records both_bad preference', () => {
      const source = createMockSource(4);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
      });

      const { prefer } = useReviewStore.getState();
      prefer('both_bad');

      const decisions = useReviewStore.getState().decisions;
      const promptRef = formatPromptRef(0);

      expect(decisions.get(promptRef)?.compare?.preference).toBe('both_bad');
    });

    it('prefer with strength sets preference and strength in one call', () => {
      const source = createMockSource(4, 2); // 4 lines, 2 groups
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
      });

      const { prefer } = useReviewStore.getState();

      // Set preference with strength in one call
      prefer('left', 2);

      const decisions = useReviewStore.getState().decisions;
      const promptRef = formatPromptRef(0);
      const decision = decisions.get(promptRef);

      expect(decision?.compare?.preference).toBe('left');
      expect(decision?.compare?.strength).toBe(2);
    });

    it('strength can be added to existing preference by going back (decision j)', () => {
      const source = createMockSource(4, 2); // 4 lines, 2 groups
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
      });

      // Set preference (cursor will auto-advance to 1)
      useReviewStore.getState().prefer('left');
      expect(useReviewStore.getState().cursor).toBe(1);

      // Go back to prompt 0
      useReviewStore.getState().prev();
      expect(useReviewStore.getState().cursor).toBe(0);

      // Add strength to existing preference
      useReviewStore.getState().prefer('left', 2);

      const decisions = useReviewStore.getState().decisions;
      const promptRef = formatPromptRef(0);
      const decision = decisions.get(promptRef);

      expect(decision?.compare?.preference).toBe('left');
      expect(decision?.compare?.strength).toBe(2);
      // Cursor should advance back to 1
      expect(useReviewStore.getState().cursor).toBe(1);
    });
  });

  describe('cursor advancement after preference', () => {
    it('cursor advances to next unreviewed prompt after prefer()', () => {
      const source = createMockSource(6, 3); // 6 lines, 3 groups: [0,1,2,0,1,2]
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0, // Start at group 0
      });

      const { prefer } = useReviewStore.getState();
      prefer('left');

      // Cursor should advance to next group index (1)
      const { cursor } = useReviewStore.getState();
      expect(cursor).toBe(1);
    });

    it('cursor advances multiple times through unreviewed prompts', () => {
      const source = createMockSource(8, 4); // 8 lines, 4 groups: [0,1,2,3,0,1,2,3]
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
      });

      const state = useReviewStore.getState();

      // Review first group (0)
      state.prefer('left');
      expect(useReviewStore.getState().cursor).toBe(1);

      // Review second group (1)
      useReviewStore.getState().prefer('right');
      expect(useReviewStore.getState().cursor).toBe(2);

      // Review third group (2)
      useReviewStore.getState().prefer('tie');
      expect(useReviewStore.getState().cursor).toBe(3);
    });

    it('cursor wraps to first unreviewed when at last prompt', () => {
      const source = createMockSource(4, 2); // 4 lines, 2 groups: [0,1,0,1]
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 1, // Start at last group (index 1)
      });

      const { prefer } = useReviewStore.getState();
      prefer('left');

      // Cursor wraps to first unreviewed group (0)
      const { cursor } = useReviewStore.getState();
      expect(cursor).toBe(0);
    });

    it('cursor stays put when all prompts reviewed', () => {
      const source = createMockSource(4, 2); // 4 lines, 2 groups: [0,1,0,1]
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
      });

      // Review both groups
      useReviewStore.getState().prefer('left'); // Group 0, cursor advances to 1
      useReviewStore.getState().prefer('right'); // Group 1, no more unreviewed

      // Cursor stays at 1 since all are reviewed
      const { cursor } = useReviewStore.getState();
      expect(cursor).toBe(1);
    });
  });

  describe('decision keys in compare mode', () => {
    it('decide() marks individual candidate status', () => {
      const source = createMockSource(4);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
        focus: 0, // Left candidate
      });

      const { decide } = useReviewStore.getState();
      const leftRef = formatCandidateRef(0, 0);

      decide(leftRef, 'kept');

      const decisions = useReviewStore.getState().decisions;
      expect(decisions.get(leftRef)?.status).toBe('kept');
    });

    it('decide() can mark right candidate independently', () => {
      const source = createMockSource(4);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
        focus: 1, // Right candidate
      });

      const { decide } = useReviewStore.getState();
      const rightRef = formatCandidateRef(1, 0); // Line 1, first candidate

      decide(rightRef, 'rejected');

      const decisions = useReviewStore.getState().decisions;
      expect(decisions.get(rightRef)?.status).toBe('rejected');
    });
  });

  describe('focus toggle', () => {
    it('toggleFocus() alternates between 0 and 1', () => {
      const source = createMockSource(4);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
        focus: 0,
      });

      const { toggleFocus } = useReviewStore.getState();

      toggleFocus();
      expect(useReviewStore.getState().focus).toBe(1);

      useReviewStore.getState().toggleFocus();
      expect(useReviewStore.getState().focus).toBe(0);

      useReviewStore.getState().toggleFocus();
      expect(useReviewStore.getState().focus).toBe(1);
    });
  });

  describe('history recording', () => {
    it('prefer() creates history entry for undo', () => {
      const source = createMockSource(4, 2);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
        past: [],
      });

      const { prefer } = useReviewStore.getState();
      prefer('left');

      const { past } = useReviewStore.getState();
      expect(past.length).toBe(1);
      expect(past[0].type).toBe('compare'); // Store uses 'compare' type
    });

    it('undo() reverses preference', () => {
      const source = createMockSource(4);
      useReviewStore.setState({
        source,
        format: flatFormat,
        mode: 'compare',
        cursor: 0,
      });

      const state = useReviewStore.getState();
      state.prefer('left');

      // Verify preference was recorded
      const promptRef = formatPromptRef(0);
      expect(useReviewStore.getState().decisions.get(promptRef)?.compare?.preference).toBe('left');

      // Undo
      useReviewStore.getState().undo();

      // Preference should be removed
      const decision = useReviewStore.getState().decisions.get(promptRef);
      expect(decision?.compare).toBeUndefined();
    });
  });
});
