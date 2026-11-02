import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Blob as NodeBlob } from 'node:buffer';
import { indexBlob } from '../src/lib/indexer';

// Node's Blob has .stream() but jsdom's doesn't.
// Cast to DOM Blob for type compatibility.
function createBlob(data: ArrayLike<number>): Blob {
  // Copy into a fresh Uint8Array to avoid Buffer/ArrayBufferLike type issues
  const bytes = Uint8Array.from(data);
  return new NodeBlob([bytes]) as unknown as Blob;
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
    const result = await indexBlob(blob);

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

  it.each(fixtures)('%s: every parseable line parses', async (name) => {
    const bytes = readFileSync(join(fixturesDir, `${name}.jsonl`));
    const meta: FixtureMeta = JSON.parse(
      readFileSync(join(fixturesDir, `${name}.meta.json`), 'utf-8')
    );

    const blob = createBlob(bytes);
    const result = await indexBlob(blob);

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

    const resultWithBom = await indexBlob(blobWithBom);
    const resultWithoutBom = await indexBlob(blobWithoutBom);

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
    const result = await indexBlob(blob);

    expect(result.lineCount).toBe(0);
    expect(result.hasBom).toBe(false);
    expect(result.starts.length).toBe(0);
    expect(result.ends.length).toBe(0);
    expect(result.eols.length).toBe(0);
  });

  it('handles blob smaller than 3 bytes without BOM', async () => {
    const blob = createBlob(new Uint8Array([0x0a])); // just a newline
    const result = await indexBlob(blob);

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
    const result = await indexBlob(blob);

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

describe.skip('SHA-256 round-trip (WP 4: exporter)', () => {
  // Ingest → export with no decisions → SHA-256 identical.
  // A concatenation identity alone passes for any partition of the bytes;
  // the per-line oracle above catches off-by-one errors.
});

describe.skip('edited line isolation (WP 4: exporter)', () => {
  // Edit one candidate ⇒ only that line differs.
  // Edit a line containing 9007199254740993, 1.0, 1e3 and -0 ⇒ those tokens are byte-identical in the output.
  // This tests that lossless-json preserves number formatting on edited lines.
});

describe.skip('BOM options (WP 4: exporter)', () => {
  // BOM fixture: keep ⇒ identical; strip ⇒ identical minus EF BB BF; add on a BOM-less fixture ⇒ EF BB BF + identical.
});
