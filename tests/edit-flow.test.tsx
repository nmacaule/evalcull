/**
 * Edit flow tests for WP 6a.
 * Tests that editing updates the store and exporter round-trip works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import { formatPromptRef } from '../src/store/refs'; // single mode acts on line refs "i" (WP 6c)
import { exportLines } from '../src/export/exportLines';
import { parsePath, normalisePath, stringifyPath, getByPath } from '../src/lib/path';
import type { RecordFormat, RecordSource, FileIndex } from '../src/types';
import { parse as losslessParse } from 'lossless-json';

/**
 * Convert Blob to string.
 */
async function blobToString(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return new TextDecoder().decode(buffer);
}

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/shapes/flat-instruction.jsonl');

const flatFormat: RecordFormat = {
  kind: 'flat',
  promptPath: 'instruction',
  responsePath: 'output',
};

/**
 * Create a mock JSONL source from fixture file.
 */
function createMockSourceFromFixture(): {
  source: Extract<RecordSource, { kind: 'jsonl' }>;
  lines: string[];
} {
  const bytes = readFileSync(FIXTURE_PATH);
  const text = new TextDecoder().decode(bytes);
  const lines = text.trim().split('\n');

  const lineCount = lines.length;
  const groups = new Uint32Array(lineCount);
  for (let i = 0; i < lineCount; i++) {
    groups[i] = i;
  }

  // Calculate byte positions
  const starts = new Float64Array(lineCount);
  const ends = new Float64Array(lineCount);
  let pos = 0;
  for (let i = 0; i < lineCount; i++) {
    starts[i] = pos;
    const lineBytes = new TextEncoder().encode(lines[i]);
    pos += lineBytes.length;
    ends[i] = pos;
    pos += 1; // newline
  }

  const index: FileIndex = {
    fingerprint: 'test-fingerprint',
    lineCount,
    starts,
    ends,
    eols: new Uint8Array(lineCount).fill(1),
    hasBom: false,
    groups,
    groupCount: lineCount,
    unparseable: new Uint32Array(0),
    candidates: new Uint16Array(lineCount).fill(1),
  };

  const source: Extract<RecordSource, { kind: 'jsonl' }> = {
    kind: 'jsonl',
    index,
    readText: async (i: number) => lines[i],
    readRaw: async (i: number) => new Blob([lines[i] + '\n']),
    readRawRange: async (from: number, to: number) => new Blob(lines.slice(from, to + 1).map((l) => l + '\n')),
  };

  return { source, lines };
}

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

describe('edit flow', () => {
  describe('store edit recording', () => {
    it('edit() stores value at normalized path', () => {
      const { source } = createMockSourceFromFixture();

      useReviewStore.setState({
        source,
        sourceName: 'flat-instruction.jsonl',
        format: flatFormat,
      });

      const { edit } = useReviewStore.getState();
      const ref = formatPromptRef(0);
      const path = 'output';
      const newValue = 'Four';

      edit(ref, path, newValue);

      const decisions = useReviewStore.getState().decisions;
      const decision = decisions.get(ref);

      expect(decision?.edits).toBeDefined();
      expect(decision?.edits?.[path]).toBe('Four');
    });

    it('edit() with undefined removes the edit (clearEdit)', () => {
      const { source } = createMockSourceFromFixture();

      useReviewStore.setState({
        source,
        sourceName: 'flat-instruction.jsonl',
        format: flatFormat,
      });

      const { edit } = useReviewStore.getState();
      const ref = formatPromptRef(0);
      const path = 'output';

      // First add an edit
      edit(ref, path, 'Four');
      expect(useReviewStore.getState().decisions.get(ref)?.edits?.[path]).toBe('Four');

      // Then remove it
      edit(ref, path, undefined);

      const decision = useReviewStore.getState().decisions.get(ref);
      expect(decision?.edits?.[path]).toBeUndefined();
    });

    it('edit() creates history entry for undo', () => {
      const { source } = createMockSourceFromFixture();

      useReviewStore.setState({
        source,
        sourceName: 'flat-instruction.jsonl',
        format: flatFormat,
        past: [],
      });

      const { edit } = useReviewStore.getState();
      const ref = formatPromptRef(0);

      edit(ref, 'output', 'Four');

      const { past } = useReviewStore.getState();
      expect(past.length).toBe(1);
      expect(past[0].type).toBe('edit');
    });

    it('undo() reverses edit', () => {
      const { source } = createMockSourceFromFixture();

      useReviewStore.setState({
        source,
        sourceName: 'flat-instruction.jsonl',
        format: flatFormat,
      });

      const ref = formatPromptRef(0);
      const path = 'output';

      // Make an edit
      useReviewStore.getState().edit(ref, path, 'Four');
      expect(useReviewStore.getState().decisions.get(ref)?.edits?.[path]).toBe('Four');

      // Undo
      useReviewStore.getState().undo();

      // Edit should be removed
      const decision = useReviewStore.getState().decisions.get(ref);
      expect(decision?.edits?.[path]).toBeUndefined();
    });
  });

  describe('path normalization', () => {
    it('normalizes negative array indices to positive', () => {
      const data = { items: ['a', 'b', 'c'] };

      // Parse path with negative index
      const segments = parsePath('items[-1]');

      // Normalize using array length resolver
      const normalized = normalisePath(segments, (segs) => {
        const arr = getByPath(data, segs);
        return Array.isArray(arr) ? arr.length : 0;
      });

      // Should resolve -1 to 2 (last element)
      const normalizedPath = stringifyPath(normalized);
      expect(normalizedPath).toBe('items[2]');
    });

    it('nested path normalization works correctly', () => {
      const data = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'Bye' },
        ],
      };

      // Parse path to last message content
      const segments = parsePath('messages[-1].content');

      const normalized = normalisePath(segments, (segs) => {
        const arr = getByPath(data, segs);
        return Array.isArray(arr) ? arr.length : 0;
      });

      const normalizedPath = stringifyPath(normalized);
      expect(normalizedPath).toBe('messages[2].content');
    });
  });

  describe('exporter round-trip', () => {
    it('exports edited line with modified value', async () => {
      const { source } = createMockSourceFromFixture();

      useReviewStore.setState({
        source,
        sourceName: 'flat-instruction.jsonl',
        format: flatFormat,
      });

      const ref = formatPromptRef(0);
      const path = 'output';
      const newValue = 'Four';

      // Make an edit
      useReviewStore.getState().edit(ref, path, newValue);

      const decisions = useReviewStore.getState().decisions;

      // Export with the edit
      const output = await exportLines(source, decisions, () => true, { bom: 'keep' });

      // Parse the output
      const outputText = await blobToString(output);
      const outputLines = outputText.trim().split('\n');

      // First line should have edited value
      const firstLine = losslessParse(outputLines[0]) as Record<string, unknown>;
      expect(firstLine.output).toBe('Four');

      // Other lines should be unchanged
      const secondLine = losslessParse(outputLines[1]) as Record<string, unknown>;
      expect(secondLine.output).toBe('Paris');
    });

    it('exports multiple edits correctly', async () => {
      const { source } = createMockSourceFromFixture();

      useReviewStore.setState({
        source,
        sourceName: 'flat-instruction.jsonl',
        format: flatFormat,
      });

      // Edit multiple lines
      useReviewStore.getState().edit(formatPromptRef(0), 'output', 'Four');
      useReviewStore.getState().edit(formatPromptRef(1), 'output', 'Lyon');
      useReviewStore.getState().edit(formatPromptRef(2), 'output', 'Blue');

      const decisions = useReviewStore.getState().decisions;
      const output = await exportLines(source, decisions, () => true, { bom: 'keep' });

      const outputText = await blobToString(output);
      const outputLines = outputText.trim().split('\n');

      const line0 = losslessParse(outputLines[0]) as Record<string, unknown>;
      const line1 = losslessParse(outputLines[1]) as Record<string, unknown>;
      const line2 = losslessParse(outputLines[2]) as Record<string, unknown>;

      expect(line0.output).toBe('Four');
      expect(line1.output).toBe('Lyon');
      expect(line2.output).toBe('Blue');
    });

    it('unedited lines are preserved byte-for-byte', async () => {
      const { source, lines } = createMockSourceFromFixture();

      useReviewStore.setState({
        source,
        sourceName: 'flat-instruction.jsonl',
        format: flatFormat,
      });

      // Only edit first line
      useReviewStore.getState().edit(formatPromptRef(0), 'output', 'Four');

      const decisions = useReviewStore.getState().decisions;
      const output = await exportLines(source, decisions, () => true, { bom: 'keep' });

      const outputText = await blobToString(output);
      const outputLines = outputText.trim().split('\n');

      // Second and third lines should be identical to original
      expect(outputLines[1]).toBe(lines[1]);
      expect(outputLines[2]).toBe(lines[2]);
    });
  });
});
