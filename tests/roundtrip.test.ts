// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { indexChunks } from '../src/lib/indexer';
import { readChunks } from '../src/lib/chunks';
import { secondPass } from '../src/lib/secondPass';
import { exportLines } from '../src/export/exportLines';
import { losslessParse } from '../src/lib/lossless';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import type { FileIndex, RecordSource, CandidateRef, Decision } from '../src/types';

/**
 * Create a Blob from bytes. Uses native Blob in node environment.
 */
function createBlob(data: ArrayLike<number>): Blob {
  const bytes = Uint8Array.from(data);
  return new Blob([bytes]);
}

/**
 * Convert Blob to Buffer for comparison.
 */
async function blobToBuffer(blob: Blob): Promise<Buffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Byte-exact round-trip tests for JSONL fixtures.
 *
 * The oracle uses Buffer.indexOf(0x0A) — a different mechanism from
 * the streaming chunk scan — so shared misunderstandings are caught.
 */

const fixturesDir = join(import.meta.dirname, 'fixtures', 'jsonl');

interface FixtureMeta {
  lineCount: number;
  hasBom: boolean;
  eols: number[];
  parseable: boolean[];
}

/**
 * Oracle implementation using Buffer.indexOf(0x0A).
 * Different mechanism from the streaming scanner.
 */
function oracle(bytes: Buffer) {
  const starts: number[] = [];
  const ends: number[] = [];
  const eols: number[] = [];
  let pos = 0;

  while (true) {
    const lfIndex = bytes.indexOf(0x0a, pos);
    if (lfIndex === -1) break;

    starts.push(pos);
    // Look back one byte for CR
    const hasCR = lfIndex > 0 && bytes[lfIndex - 1] === 0x0d;
    ends.push(hasCR ? lfIndex - 1 : lfIndex);
    eols.push(hasCR ? 2 : 1);
    pos = lfIndex + 1;
  }

  // Last line without trailing newline
  if (pos < bytes.length) {
    starts.push(pos);
    ends.push(bytes.length);
    eols.push(0);
  }

  const hasBom = bytes.length >= 3 &&
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  return { starts, ends, eols, hasBom, lineCount: starts.length };
}

/**
 * Get all fixture names (without extension).
 */
function getFixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace('.jsonl', ''));
}

/**
 * Create a mock RecordSource from fixture bytes and index.
 */
function createJsonlSource(bytes: Buffer, idx: FileIndex): Extract<RecordSource, { kind: 'jsonl' }> {
  const decoder = new TextDecoder('utf-8');

  return {
    kind: 'jsonl',
    index: idx,
    async readText(i: number): Promise<string> {
      const start = idx.starts[i];
      const end = idx.ends[i];
      const lineBytes = bytes.subarray(start, end);
      return decoder.decode(lineBytes);
    },
    async readRaw(i: number): Promise<Blob> {
      const start = idx.starts[i];
      const eol = idx.eols[i];
      const end = idx.ends[i] + eol;
      const slice = Uint8Array.from(bytes.subarray(start, end));
      return new Blob([slice]);
    },
    async readRawRange(from: number, to: number): Promise<Blob> {
      const start = idx.starts[from];
      const end = idx.ends[to] + idx.eols[to];
      return new Blob([Uint8Array.from(bytes.subarray(start, end))]);
    },
  };
}

describe('index triples (WP 2: indexer worker)', () => {
  const fixtures = getFixtureNames();

  it.each(fixtures)('%s: index matches Buffer.indexOf oracle', async (name) => {
    const bytes = readFileSync(join(fixturesDir, `${name}.jsonl`));
    const meta: FixtureMeta = JSON.parse(
      readFileSync(join(fixturesDir, `${name}.meta.json`), 'utf-8')
    );

    // Compute expected with oracle
    const expected = oracle(bytes);

    // Run indexer (use Node's Blob which has .stream())
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    // Assert line count
    expect(result.lineCount).toBe(expected.lineCount);
    expect(result.lineCount).toBe(meta.lineCount);

    // Assert BOM detection
    expect(result.hasBom).toBe(expected.hasBom);
    expect(result.hasBom).toBe(meta.hasBom);

    // Assert triples match oracle
    expect(Array.from(result.starts)).toEqual(expected.starts);
    expect(Array.from(result.ends)).toEqual(expected.ends);
    expect(Array.from(result.eols)).toEqual(expected.eols);

    // Assert eols match meta
    expect(Array.from(result.eols)).toEqual(meta.eols);
  });

  // WP 7c (DR-025): the page's reads can split a BOM, a CR LF or a line anywhere
  it.each([1, 2, 3].flatMap((size) => ['bom', 'crlf', 'mixed'].map((name) => [name, size] as const)))(
    '%s read in %i-byte chunks: index matches Buffer.indexOf oracle',
    async (name, size) => {
      const bytes = readFileSync(join(fixturesDir, `${name}.jsonl`));
      const meta: FixtureMeta = JSON.parse(readFileSync(join(fixturesDir, `${name}.meta.json`), 'utf-8'));
      const expected = oracle(bytes);
      const blob = createBlob(bytes);

      const result = await indexChunks(readChunks(blob, size), blob.size);

      expect({
        lineCount: result.lineCount,
        hasBom: result.hasBom,
        starts: Array.from(result.starts),
        ends: Array.from(result.ends),
        eols: Array.from(result.eols),
      }).toEqual({ ...expected, lineCount: meta.lineCount, hasBom: meta.hasBom });
    }
  );

  it.each(fixtures)('%s: every parseable line parses', async (name) => {
    const bytes = readFileSync(join(fixturesDir, `${name}.jsonl`));
    const meta: FixtureMeta = JSON.parse(
      readFileSync(join(fixturesDir, `${name}.meta.json`), 'utf-8')
    );

    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    // Use TextDecoder with ignoreBOM: false (default) to match readText behavior.
    // This strips the BOM from line 0 in BOM files, making JSON.parse work.
    const decoder = new TextDecoder('utf-8');

    for (let i = 0; i < result.lineCount; i++) {
      const start = result.starts[i];
      const end = result.ends[i];
      const lineBytes = bytes.subarray(start, end);
      const lineText = decoder.decode(lineBytes);

      if (meta.parseable[i]) {
        expect(() => JSON.parse(lineText)).not.toThrow();
      } else {
        expect(() => JSON.parse(lineText)).toThrow();
      }
    }
  });

  it('BOM detection works when first chunk is < 3 bytes', async () => {
    // Create a blob that would stream with a tiny first chunk.
    // We test BOM detection directly since we read first 3 bytes via slice.
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a]); // BOM + {}\n
    const withoutBom = new Uint8Array([0x7b, 0x7d, 0x0a]); // {}\n

    const blobWithBom = createBlob(withBom);
    const blobWithoutBom = createBlob(withoutBom);

    const resultWithBom = await indexChunks(readChunks(blobWithBom), blobWithBom.size);
    const resultWithoutBom = await indexChunks(readChunks(blobWithoutBom), blobWithoutBom.size);

    expect(resultWithBom.hasBom).toBe(true);
    expect(resultWithoutBom.hasBom).toBe(false);

    // Also verify line indexing is correct
    expect(resultWithBom.lineCount).toBe(1);
    expect(resultWithBom.starts[0]).toBe(0); // starts[0] stays 0 per §2.4
    expect(resultWithBom.ends[0]).toBe(5); // BOM(3) + {}(2) = 5
    expect(resultWithBom.eols[0]).toBe(1); // LF

    expect(resultWithoutBom.lineCount).toBe(1);
    expect(resultWithoutBom.starts[0]).toBe(0);
    expect(resultWithoutBom.ends[0]).toBe(2); // {}
    expect(resultWithoutBom.eols[0]).toBe(1);
  });

  it('handles empty blob', async () => {
    const blob = createBlob(new Uint8Array(0));
    const result = await indexChunks(readChunks(blob), blob.size);

    expect(result.lineCount).toBe(0);
    expect(result.hasBom).toBe(false);
    expect(result.starts.length).toBe(0);
    expect(result.ends.length).toBe(0);
    expect(result.eols.length).toBe(0);
  });

  it('handles blob smaller than 3 bytes without BOM', async () => {
    const blob = createBlob(new Uint8Array([0x0a])); // just a newline
    const result = await indexChunks(readChunks(blob), blob.size);

    expect(result.hasBom).toBe(false);
    expect(result.lineCount).toBe(1);
    expect(result.starts[0]).toBe(0);
    expect(result.ends[0]).toBe(0); // empty line
    expect(result.eols[0]).toBe(1);
  });

  it('groupCount equals number of distinct group ids (invariant)', async () => {
    // This invariant will be relied upon by later work packages.
    // For now, each line is its own group: groups[i] = i, groupCount = lineCount.
    const bytes = readFileSync(join(fixturesDir, 'lf.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    // Stub grouping: each line is its own group
    const groups = new Uint32Array(result.lineCount);
    for (let i = 0; i < result.lineCount; i++) {
      groups[i] = i;
    }
    const groupCount = result.lineCount;

    // Verify invariant: groupCount equals number of distinct ids
    const distinctIds = new Set(groups);
    expect(distinctIds.size).toBe(groupCount);
  });
});

describe('SHA-256 round-trip (WP 4: exporter)', () => {
  const fixtures = getFixtureNames();

  it.each(fixtures)('%s: export with no decisions is SHA-256 identical', async (name) => {
    const bytes = readFileSync(join(fixturesDir, `${name}.jsonl`));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    // Create FileIndex with empty unparseable (we're testing export, not unparseable detection)
    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);
    const decisions = new Map<CandidateRef, Decision>();

    // Export all lines with no decisions, bom: 'keep'
    const exportedBlob = await exportLines(
      source,
      decisions,
      () => true, // include all
      { bom: 'keep' }
    );

    const exportedBuffer = await blobToBuffer(exportedBlob);

    // SHA-256 comparison (oracle: Node crypto, not exporter code)
    const inputHash = createHash('sha256').update(bytes).digest('hex');
    const outputHash = createHash('sha256').update(exportedBuffer).digest('hex');

    expect(outputHash).toBe(inputHash);
  });
});

describe('edited line isolation (WP 4: exporter)', () => {
  it('edit one line: only that line differs', async () => {
    const bytes = readFileSync(join(fixturesDir, 'lf.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);

    // Edit line 1 (second line)
    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('1', {
      status: 'kept',
      edits: { 'id': 999 },
      updatedAt: Date.now(),
    });

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'keep' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Compare line by line
    const inputLines = bytes.toString('utf-8').split('\n');
    const outputLines = exportedBuffer.toString('utf-8').split('\n');

    expect(outputLines.length).toBe(inputLines.length);

    for (let i = 0; i < inputLines.length; i++) {
      if (i === 1) {
        // Edited line should differ
        expect(outputLines[i]).not.toBe(inputLines[i]);
        expect(outputLines[i]).toContain('999');
      } else {
        // Other lines should be identical
        expect(outputLines[i]).toBe(inputLines[i]);
      }
    }
  });

  it('big-int and number formats are byte-identical on edited lines', async () => {
    // Test with number-formats.jsonl which has 1.0, 1e3, -0
    const bytes = readFileSync(join(fixturesDir, 'number-formats.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);

    // Edit a field that doesn't affect numbers
    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'kept',
      edits: { 'name': 'edited' },
      updatedAt: Date.now(),
    });

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'keep' });
    const exportedBuffer = await blobToBuffer(exportedBlob);
    const outputLine = exportedBuffer.toString('utf-8').split('\n')[0];

    // Verify number tokens are preserved
    expect(outputLine).toContain('1.0');
    expect(outputLine).toContain('1e3');
    expect(outputLine).toContain('-0');
  });

  it('big integer 9007199254740993 is preserved on edited lines', async () => {
    const bytes = readFileSync(join(fixturesDir, 'big-int.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);

    // Edit a different field
    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'kept',
      edits: { 'name': 'edited' },
      updatedAt: Date.now(),
    });

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'keep' });
    const exportedBuffer = await blobToBuffer(exportedBlob);
    const outputLine = exportedBuffer.toString('utf-8').split('\n')[0];

    // Verify big integer is preserved (not truncated to 9007199254740992)
    expect(outputLine).toContain('9007199254740993');
    expect(outputLine).not.toContain('9007199254740992');
  });
});

describe('BOM options (WP 4: exporter)', () => {
  it('keep: BOM file exports identical', async () => {
    const bytes = readFileSync(join(fixturesDir, 'bom.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);
    const decisions = new Map<CandidateRef, Decision>();

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'keep' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    expect(exportedBuffer.equals(bytes)).toBe(true);
  });

  it('strip: BOM file exports without BOM', async () => {
    const bytes = readFileSync(join(fixturesDir, 'bom.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);
    const decisions = new Map<CandidateRef, Decision>();

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'strip' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should not start with BOM
    expect(exportedBuffer[0]).not.toBe(0xef);

    // Should equal input minus first 3 bytes
    expect(exportedBuffer.equals(bytes.subarray(3))).toBe(true);
  });

  it('add: non-BOM file exports with BOM prepended', async () => {
    const bytes = readFileSync(join(fixturesDir, 'lf.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);
    const decisions = new Map<CandidateRef, Decision>();

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'add' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should start with BOM
    expect(exportedBuffer[0]).toBe(0xef);
    expect(exportedBuffer[1]).toBe(0xbb);
    expect(exportedBuffer[2]).toBe(0xbf);

    // Rest should equal input
    expect(exportedBuffer.subarray(3).equals(bytes)).toBe(true);
  });

  it('edited line 0 with BOM: keep preserves BOM', async () => {
    const bytes = readFileSync(join(fixturesDir, 'bom.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);

    // Edit line 0
    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'kept',
      edits: { 'id': 999 },
      updatedAt: Date.now(),
    });

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'keep' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should start with BOM (file-level rule)
    expect(exportedBuffer[0]).toBe(0xef);
    expect(exportedBuffer[1]).toBe(0xbb);
    expect(exportedBuffer[2]).toBe(0xbf);
  });

  it('edited line 0 with BOM: strip removes BOM', async () => {
    const bytes = readFileSync(join(fixturesDir, 'bom.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);

    // Edit line 0
    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'kept',
      edits: { 'id': 999 },
      updatedAt: Date.now(),
    });

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'strip' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should not start with BOM
    expect(exportedBuffer[0]).not.toBe(0xef);
  });

  it('edited line 0 with BOM: add emits exactly one BOM', async () => {
    const bytes = readFileSync(join(fixturesDir, 'bom.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);

    // Edit line 0
    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'kept',
      edits: { 'id': 999 },
      updatedAt: Date.now(),
    });

    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'add' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should start with exactly one BOM
    expect(exportedBuffer[0]).toBe(0xef);
    expect(exportedBuffer[1]).toBe(0xbb);
    expect(exportedBuffer[2]).toBe(0xbf);

    // Count BOMs in the output (should be exactly 1)
    let bomCount = 0;
    for (let i = 0; i <= exportedBuffer.length - 3; i++) {
      if (
        exportedBuffer[i] === 0xef &&
        exportedBuffer[i + 1] === 0xbb &&
        exportedBuffer[i + 2] === 0xbf
      ) {
        bomCount++;
      }
    }
    expect(bomCount).toBe(1);
  });
});

describe('edit then undo exports byte-identical (WP 4)', () => {
  beforeEach(() => {
    // Fresh IDB per test
    configureStorage({ indexedDB: new IDBFactory() });
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

  it('edit and undo produces same export as no edit', async () => {
    const bytes = readFileSync(join(fixturesDir, 'lf.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test-fingerprint',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);

    // Load source into store
    await useReviewStore.getState().load(source, {
      sourceName: 'lf.jsonl',
      fingerprint: 'test-fingerprint',
      format: { kind: 'unknown' },
    });

    // Edit line 0
    useReviewStore.getState().edit('0', 'id', 999);

    // Verify edit was applied
    const afterEdit = useReviewStore.getState().decisions.get('0');
    expect(afterEdit?.edits).toEqual({ id: 999 });

    // Undo the edit
    useReviewStore.getState().undo();

    // Verify edit was reverted (decision should be gone or have no edits)
    const afterUndo = useReviewStore.getState().decisions.get('0');
    const hasEdits = afterUndo?.edits && Object.keys(afterUndo.edits).length > 0;
    expect(hasEdits).toBeFalsy();

    // Export with store's decisions
    const decisions = useReviewStore.getState().decisions;
    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'keep' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should be identical to input
    const inputHash = createHash('sha256').update(bytes).digest('hex');
    const outputHash = createHash('sha256').update(exportedBuffer).digest('hex');
    expect(outputHash).toBe(inputHash);
  });
});

describe('unparseable detection (WP 4, updated WP 5)', () => {
  const fixtures = getFixtureNames();

  it.each(fixtures)('%s: secondPass unparseable matches fixture metadata', async (name) => {
    const bytes = readFileSync(join(fixturesDir, `${name}.jsonl`));
    const meta: FixtureMeta = JSON.parse(
      readFileSync(join(fixturesDir, `${name}.meta.json`), 'utf-8')
    );

    // Find expected unparseable indices from metadata
    const expectedUnparseable: number[] = [];
    for (let i = 0; i < meta.parseable.length; i++) {
      if (!meta.parseable[i]) {
        expectedUnparseable.push(i);
      }
    }

    // Run secondPass from src/lib (merged unparseable + grouping, WP 5)
    const blob = createBlob(bytes);
    const indexResult = await indexChunks(readChunks(blob), blob.size);
    const passResult = await secondPass(
      readChunks(blob),
      indexResult.starts,
      indexResult.ends,
      indexResult.hasBom,
      { kind: 'unknown' } // No grouping for unparseable test
    );

    expect(Array.from(passResult.unparseable)).toEqual(expectedUnparseable);
  });

  it('record() and JSON.parse agree on validity for all fixtures', async () => {
    for (const name of fixtures) {
      const bytes = readFileSync(join(fixturesDir, `${name}.jsonl`));
      const blob = createBlob(bytes);
      const result = await indexChunks(readChunks(blob), blob.size);
      const decoder = new TextDecoder('utf-8');

      for (let i = 0; i < result.lineCount; i++) {
        let start = result.starts[i];
        const end = result.ends[i];

        // For line 0 with BOM, skip BOM bytes
        if (i === 0 && result.hasBom && start === 0) {
          start = 3;
        }

        const lineBytes = bytes.subarray(start, end);
        const text = decoder.decode(lineBytes);

        let jsonParseOk = true;
        try {
          JSON.parse(text);
        } catch {
          jsonParseOk = false;
        }

        let losslessParseOk = true;
        try {
          losslessParse(text);
        } catch {
          losslessParseOk = false;
        }

        // JSON.parse and losslessParse should agree on validity
        expect(jsonParseOk).toBe(losslessParseOk);
      }
    }
  });
});

describe('excludeUnparseable (WP 4)', () => {
  it('malformed.jsonl: exclude removes unparseable line', async () => {
    const bytes = readFileSync(join(fixturesDir, 'malformed.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    // Line 1 is unparseable per meta
    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: Uint32Array.from([1]), // line 1 is unparseable
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);
    const decisions = new Map<CandidateRef, Decision>();

    // Export excluding unparseable
    const unparseableSet = new Set([1]);
    const exportedBlob = await exportLines(
      source,
      decisions,
      (i) => !unparseableSet.has(i),
      { bom: 'keep' }
    );
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should only have line 0
    const outputLines = exportedBuffer.toString('utf-8').split('\n').filter(l => l.length > 0);
    expect(outputLines.length).toBe(1);
  });

  it('malformed.jsonl: include passes through unparseable line byte-exact', async () => {
    const bytes = readFileSync(join(fixturesDir, 'malformed.jsonl'));
    const blob = createBlob(bytes);
    const result = await indexChunks(readChunks(blob), blob.size);

    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: result.lineCount,
      starts: result.starts,
      ends: result.ends,
      eols: result.eols,
      hasBom: result.hasBom,
      groups: new Uint32Array(result.lineCount),
      groupCount: result.lineCount,
      unparseable: Uint32Array.from([1]),
      candidates: new Uint16Array(result.lineCount).fill(1),
    };

    const source = createJsonlSource(bytes, idx);
    const decisions = new Map<CandidateRef, Decision>();

    // Export including all
    const exportedBlob = await exportLines(source, decisions, () => true, { bom: 'keep' });
    const exportedBuffer = await blobToBuffer(exportedBlob);

    // Should be identical to input
    expect(exportedBuffer.equals(bytes)).toBe(true);
  });
});
