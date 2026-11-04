// @vitest-environment node
/**
 * The benchmark's inlined passes match the real ones (verification gap: the
 * bench could otherwise measure stale code).
 *
 * Oracle: src/lib/indexer.ts and src/lib/secondPass.ts on the same bytes. The
 * inlined copies are a separate implementation, so agreement is a real check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { indexBlob as realIndexBlob } from '../src/lib/indexer';
import { secondPass } from '../src/lib/secondPass';
import { indexBlob as benchIndexBlob, secondPassInline } from '../scripts/bench-inline.mjs';
import type { RecordFormat } from '../src/types';

const JSONL_DIR = join(import.meta.dirname, 'fixtures/jsonl');
// The bench's data: { id, text }, grouped by id
const BENCH_FORMAT: RecordFormat = { kind: 'flat', promptPath: 'id', responsePath: 'text' };

describe('bench-inline matches the indexer', () => {
  const fixtures = readdirSync(JSONL_DIR).filter((f) => f.endsWith('.jsonl'));

  it.each(fixtures)('first pass: %s', async (name) => {
    const blob = new Blob([readFileSync(join(JSONL_DIR, name))]);
    const real = await realIndexBlob(blob);
    const bench = await benchIndexBlob(blob);
    expect(Array.from(bench.starts)).toEqual(Array.from(real.starts));
    expect(Array.from(bench.ends)).toEqual(Array.from(real.ends));
    expect(Array.from(bench.eols)).toEqual(Array.from(real.eols));
    expect(bench.hasBom).toBe(real.hasBom);
    expect(bench.lineCount).toBe(real.lineCount);
  });

  it('second pass on bench-shaped data with shared ids and a malformed line', async () => {
    const text =
      '{"id":1,"text":"a"}\n{"id":2,"text":"b"}\nnot json\n{"id":1,"text":"c"}\r\n{"id":3,"text":"d"}';
    const blob = new Blob([text]);
    const first = await realIndexBlob(blob);
    const real = await secondPass(blob, first.starts, first.ends, first.hasBom, BENCH_FORMAT);
    const bench = await secondPassInline(blob, await benchIndexBlob(blob));
    expect(bench.unparseable).toEqual(Array.from(real.unparseable));
    expect(Array.from(bench.groups)).toEqual(Array.from(real.groups));
    expect(bench.groupCount).toBe(real.groupCount);
    expect(Array.from(bench.candidates)).toEqual(Array.from(real.candidates));
  });
});
