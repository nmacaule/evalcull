// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExport } from '../src/export/buildExport';
import { computeExportStats } from '../src/export/stats';
import { exportRows } from '../src/export/exportRows';
import { exportLines } from '../src/export/exportLines';
import type {
  RecordSource,
  RecordFormat,
  FileIndex,
  CandidateRef,
  Decision,
} from '../src/types';
import type { ParsedRecord } from '../src/store/types';

/**
 * Convert Blob to string.
 */
async function blobToString(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return Buffer.from(buffer).toString('utf-8');
}

/**
 * Create a mock JSONL source.
 */
function createMockJsonlSource(
  records: unknown[],
  unparseable: number[] = []
): Extract<RecordSource, { kind: 'jsonl' }> {
  const idx: FileIndex = {
    fingerprint: 'test',
    lineCount: records.length,
    starts: Float64Array.from(records.map((_, i) => i * 100)),
    ends: Float64Array.from(records.map((_, i) => i * 100 + 50)),
    eols: Uint8Array.from(records.map(() => 1)),
    hasBom: false,
    groups: Uint32Array.from(records.map((_, i) => i)),
    groupCount: records.length,
    unparseable: Uint32Array.from(unparseable),
    candidates: new Uint16Array(records.length).fill(1),
  };

  return {
    kind: 'jsonl',
    index: idx,
    async readText(i: number): Promise<string> {
      return JSON.stringify(records[i]);
    },
    async readRaw(i: number): Promise<Blob> {
      const text = JSON.stringify(records[i]) + '\n';
      return new Blob([text]);
    },
    async readRawRange(from: number, to: number): Promise<Blob> {
      return new Blob(records.slice(from, to + 1).map((r) => JSON.stringify(r) + '\n'));
    },
  };
}

/**
 * Create a mock rows source.
 */
function createMockRowsSource(records: unknown[]): Extract<RecordSource, { kind: 'rows' }> {
  return {
    kind: 'rows',
    container: 'json',
    count: records.length,
    async readRow(i: number): Promise<unknown> {
      return records[i];
    },
  };
}

/**
 * Create a record function for buildExport.
 */
function createRecordFn(records: unknown[]): (i: number) => Promise<ParsedRecord> {
  return async (i: number) => {
    if (i < 0 || i >= records.length) {
      return { index: i, ok: false, error: 'Out of bounds', raw: '' };
    }
    return { index: i, ok: true, data: records[i] };
  };
}

describe('buildExport dispatch (WP 4)', () => {
  it('pairs.vertex.jsonl throws not implemented', async () => {
    const records = [{ prompt: 'test', candidates: ['a', 'b'] }];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'candidates' };

    await expect(
      buildExport('pairs.vertex.jsonl', {
        source,
        decisions: new Map(),
        format,
        record: createRecordFn(records),
      })
    ).rejects.toThrow('pairs.vertex.jsonl not implemented until WP 12');
  });

  it('kept.jsonl exports only kept records', async () => {
    const records = [
      { id: 1, text: 'kept' },
      { id: 2, text: 'rejected' },
      { id: 3, text: 'kept2' },
    ];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'unknown' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', { status: 'kept', updatedAt: Date.now() });
    decisions.set('1', { status: 'rejected', updatedAt: Date.now() });
    decisions.set('2', { status: 'kept', updatedAt: Date.now() });

    const result = await buildExport('kept.jsonl', {
      source,
      decisions,
      format,
      record: createRecordFn(records),
    });

    expect(result.stats.lineCount).toBe(2);
    expect(result.stats.byteExact).toBe(true);
  });

  it('rejected.jsonl exports only rejected records', async () => {
    const records = [
      { id: 1, text: 'kept' },
      { id: 2, text: 'rejected' },
    ];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'unknown' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', { status: 'kept', updatedAt: Date.now() });
    decisions.set('1', { status: 'rejected', updatedAt: Date.now() });

    const result = await buildExport('rejected.jsonl', {
      source,
      decisions,
      format,
      record: createRecordFn(records),
    });

    expect(result.stats.lineCount).toBe(1);
  });

  it('skipped.jsonl exports only skipped records', async () => {
    const records = [
      { id: 1, text: 'skipped' },
      { id: 2, text: 'kept' },
    ];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'unknown' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', { status: 'skipped', updatedAt: Date.now() });
    decisions.set('1', { status: 'kept', updatedAt: Date.now() });

    const result = await buildExport('skipped.jsonl', {
      source,
      decisions,
      format,
      record: createRecordFn(records),
    });

    expect(result.stats.lineCount).toBe(1);
  });

  it('all.decisions.jsonl includes all records with _triage', async () => {
    const records = [
      { id: 1, text: 'first' },
      { id: 2, text: 'second' },
    ];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'unknown' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', { status: 'kept', updatedAt: 1234567890 });

    const result = await buildExport('all.decisions.jsonl', {
      source,
      decisions,
      format,
      record: createRecordFn(records),
    });

    const content = await blobToString(result.blob);
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(2);

    const line0 = JSON.parse(lines[0]);
    expect(line0.id).toBe(1);
    expect(line0._triage).toBeDefined();
    expect(line0._triage.status).toBe('kept');
    expect(line0._triage.edited).toBe(false);

    const line1 = JSON.parse(lines[1]);
    expect(line1.id).toBe(2);
    expect(line1._triage.status).toBe('unreviewed');
  });

  it('pairs.jsonl excludes ties and both_bad', async () => {
    const records = [
      { prompt: 'Q1', candidates: ['A', 'B'] },
      { prompt: 'Q2', candidates: ['C', 'D'] },
      { prompt: 'Q3', candidates: ['E', 'F'] },
    ];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'candidates' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'unreviewed',
      compare: [{ left: '0:0', right: '0:1', preference: 'left' }],
      updatedAt: Date.now(),
    });
    decisions.set('1', {
      status: 'unreviewed',
      compare: [{ left: '1:0', right: '1:1', preference: 'tie' }],
      updatedAt: Date.now(),
    });
    decisions.set('2', {
      status: 'unreviewed',
      compare: [{ left: '2:0', right: '2:1', preference: 'both_bad' }],
      updatedAt: Date.now(),
    });

    const result = await buildExport('pairs.jsonl', {
      source,
      decisions,
      format,
      record: createRecordFn(records),
    });

    expect(result.stats.pairsCount).toBe(1);
    expect(result.stats.tiesExcluded).toBe(1);
    expect(result.stats.bothBadExcluded).toBe(1);
  });
});

describe("exportLines reads unedited lines by run (D-006)", () => {
  it('exports 10,000 unedited lines with one edit in the middle in exactly 2 raw reads', async () => {
    const records = Array.from({ length: 10000 }, (_, i) => ({ id: i }));
    const base = createMockJsonlSource(records);
    let rawReads = 0;
    const src = {
      ...base,
      readRaw: async (i: number) => {
        rawReads++;
        return base.readRaw(i);
      },
      readRawRange: async (from: number, to: number) => {
        rawReads++;
        return new Blob(records.slice(from, to + 1).map((r) => JSON.stringify(r) + '\n'));
      },
    };
    const decisions = new Map<CandidateRef, Decision>([
      ['5000', { status: 'unreviewed', edits: { id: 'edited' }, updatedAt: 1 }],
    ]);

    const blob = await exportLines(src, decisions, () => true, { bom: 'keep' });

    // Lines 0..4999 and 5001..9999 are one read each; line 5000 is re-serialised from readText
    expect(rawReads).toBe(2);
    const lines = (await blobToString(blob)).split('\n');
    expect(lines.length).toBe(10001);
    expect(lines[4999]).toBe('{"id":4999}');
    expect(lines[5000]).toBe('{"id":"edited"}');
    expect(lines[5001]).toBe('{"id":5001}');
    expect(lines[10000]).toBe('');
  });
});

describe("exportLines yields to the event loop (D-008)", () => {
  it('lets a timer scheduled before a 5,001-line kept.jsonl export run before the export resolves', async () => {
    const records = Array.from({ length: 5001 }, (_, i) => ({ id: i }));
    const src = createMockJsonlSource(records);
    const decisions = new Map<CandidateRef, Decision>();
    for (let i = 0; i < records.length; i++) {
      decisions.set(String(i), { status: 'kept', updatedAt: 1 });
    }

    // Only a macrotask yield inside the export lets this run before it resolves
    let timerRan = false;
    setTimeout(() => {
      timerRan = true;
    }, 0);

    const result = await buildExport('kept.jsonl', {
      source: src,
      decisions,
      format: { kind: 'unknown' },
      record: createRecordFn(records),
    });
    expect(result.stats.lineCount).toBe(5001);
    expect(timerRan).toBe(true);
  });
});

describe('computeExportStats (WP 4)', () => {
  it('computes preview stats without reading records', () => {
    const records = [
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'unknown' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', { status: 'kept', updatedAt: Date.now() });
    decisions.set('1', { status: 'rejected', updatedAt: Date.now() });
    decisions.set('2', { status: 'kept', edits: { 'id': 999 }, updatedAt: Date.now() });

    const stats = computeExportStats('kept.jsonl', source, decisions, format, {});

    expect(stats.name).toBe('kept.jsonl');
    expect(stats.byteExact).toBe(true);
    expect(stats.lineCount).toBe(2);
    expect(stats.editsExported).toBe(1);
  });

  it('byteExact is false for pairs and all.decisions', () => {
    const source = createMockJsonlSource([{ id: 1 }]);
    const format: RecordFormat = { kind: 'unknown' };
    const decisions = new Map<CandidateRef, Decision>();

    const pairsStats = computeExportStats('pairs.jsonl', source, decisions, format, {});
    expect(pairsStats.byteExact).toBe(false);

    const allStats = computeExportStats('all.decisions.jsonl', source, decisions, format, {});
    expect(allStats.byteExact).toBe(false);
  });

  it('counts unparseableExcluded when excludeUnparseable is true', () => {
    const records = [{ id: 1 }, { id: 2 }];
    const source = createMockJsonlSource(records, [1]); // line 1 is unparseable
    const format: RecordFormat = { kind: 'unknown' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', { status: 'kept', updatedAt: Date.now() });
    decisions.set('1', { status: 'kept', updatedAt: Date.now() });

    const stats = computeExportStats('kept.jsonl', source, decisions, format, { excludeUnparseable: true });

    expect(stats.unparseableExcluded).toBe(1);
    expect(stats.lineCount).toBe(1);
  });
});

describe('exportRows (WP 4)', () => {
  it('exports rows source to JSONL', async () => {
    const records = [
      { id: 1, text: 'first' },
      { id: 2, text: 'second' },
    ];
    const source = createMockRowsSource(records);

    const decisions = new Map<CandidateRef, Decision>();

    const blob = await exportRows(source, decisions, () => true);
    const content = await blobToString(blob);
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ id: 1, text: 'first' });
    expect(JSON.parse(lines[1])).toEqual({ id: 2, text: 'second' });
  });

  it('applies edits to rows', async () => {
    const records = [{ id: 1, text: 'original' }];
    const source = createMockRowsSource(records);

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'kept',
      edits: { 'text': 'edited' },
      updatedAt: Date.now(),
    });

    const blob = await exportRows(source, decisions, () => true);
    const content = await blobToString(blob);
    const line = JSON.parse(content.trim());

    expect(line.text).toBe('edited');
  });

  it('filters rows by include function', async () => {
    const records = [
      { id: 1, text: 'keep' },
      { id: 2, text: 'skip' },
    ];
    const source = createMockRowsSource(records);

    const decisions = new Map<CandidateRef, Decision>();

    const blob = await exportRows(source, decisions, (i) => i === 0);
    const content = await blobToString(blob);
    const lines = content.trim().split('\n').filter(l => l.length > 0);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).id).toBe(1);
  });
});

describe('all.decisions.jsonl per-candidate triage (D-011)', () => {
  it('exports a status, labels and score on in-record candidate "0:1" under _triage.candidates["1"] of line 0', async () => {
    const records = [
      { prompt: 'P', responses: ['a', 'b'] },
      { prompt: 'Q', responses: ['c', 'd'] },
    ];
    const source = createMockJsonlSource(records);
    source.index.candidates = Uint16Array.from([2, 2]);
    const decisions = new Map<CandidateRef, Decision>([
      ['0:1', { status: 'kept', labels: ['good'], score: 5, updatedAt: 7 }],
    ]);

    const result = await buildExport('all.decisions.jsonl', {
      source,
      decisions,
      format: { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'responses' },
      record: createRecordFn(records),
    });

    expect(await blobToString(result.blob)).toBe(
      '{"prompt":"P","responses":["a","b"],"_triage":{"status":"unreviewed","edited":false,"updatedAt":0,' +
        '"candidates":{"1":{"status":"kept","labels":["good"],"score":5,"edited":false,"updatedAt":7}}}}\n' +
        '{"prompt":"Q","responses":["c","d"],"_triage":{"status":"unreviewed","edited":false,"updatedAt":0}}\n'
    );
  });
});

describe('all.decisions.jsonl candidate values (D-012)', () => {
  it('writes only status, labels, score, notes, edited and updatedAt for a candidate entry that carries a compare', async () => {
    const records = [{ prompt: 'P', responses: ['a', 'b'] }];
    const source = createMockJsonlSource(records);
    source.index.candidates = Uint16Array.from([2]);
    // A candidate entry never gets a compare from the UI; a hand-edited or imported session can carry one
    const decisions = new Map<CandidateRef, Decision>([
      ['0:1', { status: 'kept', compare: [{ left: '0:0', right: '0:1', preference: 'left' }], updatedAt: 7 }],
    ]);

    const result = await buildExport('all.decisions.jsonl', {
      source,
      decisions,
      format: { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'responses' },
      record: createRecordFn(records),
    });

    expect(await blobToString(result.blob)).toBe(
      '{"prompt":"P","responses":["a","b"],"_triage":{"status":"unreviewed","edited":false,"updatedAt":0,' +
        '"candidates":{"1":{"status":"kept","edited":false,"updatedAt":7}}}}\n'
    );
  });
});

describe('all.decisions.jsonl _triage shape (WP 4)', () => {
  it('_triage has correct field order and shape', async () => {
    const records = [{ id: 1, value: 9007199254740993 }];
    const source = createMockJsonlSource(records);
    const format: RecordFormat = { kind: 'unknown' };

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'kept',
      compare: [{ left: '0:0', right: '0:1', preference: 'left', strength: 3 }],
      labels: ['good'],
      score: 5,
      notes: 'test note',
      edits: { 'value': 42 },
      updatedAt: 1234567890,
    });

    const result = await buildExport('all.decisions.jsonl', {
      source,
      decisions,
      format,
      record: createRecordFn(records),
    });

    const content = await blobToString(result.blob);
    const line = JSON.parse(content.trim());

    expect(line._triage).toBeDefined();
    expect(line._triage.status).toBe('kept');
    expect(line._triage.compare).toEqual([{ left: '0:0', right: '0:1', preference: 'left', strength: 3 }]);
    expect(line._triage.labels).toEqual(['good']);
    expect(line._triage.score).toBe(5);
    expect(line._triage.notes).toBe('test note');
    expect(line._triage.edited).toBe(true);
    expect(line._triage.updatedAt).toBe(1234567890);
  });

  it('preserves number tokens verbatim in re-serialised output', async () => {
    // Test that lossless-json preserves exact number formatting
    const literalLine = '{"int":9007199254740993,"float":1.0,"exp":1e3,"negzero":-0}';

    // Create a source that returns literal text (not JSON.stringify)
    const idx: FileIndex = {
      fingerprint: 'test',
      lineCount: 1,
      starts: Float64Array.from([0]),
      ends: Float64Array.from([literalLine.length]),
      eols: Uint8Array.from([1]),
      hasBom: false,
      groups: Uint32Array.from([0]),
      groupCount: 1,
      unparseable: Uint32Array.from([]),
      candidates: new Uint16Array(1).fill(1),
    };

    const source: Extract<RecordSource, { kind: 'jsonl' }> = {
      kind: 'jsonl',
      index: idx,
      async readText(): Promise<string> {
        return literalLine;
      },
      async readRaw(): Promise<Blob> {
        return new Blob([literalLine + '\n']);
      },
      async readRawRange(from: number, to: number): Promise<Blob> {
        return new Blob(Array.from({ length: to - from + 1 }, () => literalLine + '\n'));
      },
    };

    const format: RecordFormat = { kind: 'unknown' };
    const decisions = new Map<CandidateRef, Decision>();

    // record() uses losslessParse to preserve number tokens
    const { losslessParse } = await import('../src/lib/lossless');
    const record = async () => ({
      index: 0,
      ok: true as const,
      data: losslessParse(literalLine),
    });

    const result = await buildExport('all.decisions.jsonl', {
      source,
      decisions,
      format,
      record,
    });

    const content = await blobToString(result.blob);

    // All four number tokens must appear verbatim
    expect(content).toContain('9007199254740993');
    expect(content).toContain('1.0');
    expect(content).toContain('1e3');
    expect(content).toContain('-0');
  });
});

describe('pairs.jsonl per judged pair (WP 6c)', () => {
  interface KnockoutFixture {
    format: RecordFormat;
    records: unknown[];
    decisions: Record<CandidateRef, Decision>;
    expectedPairs: unknown[];
    expectedExcluded: { ties: number; bothBad: number };
  }

  function loadFixture(name: string): KnockoutFixture {
    return JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures', 'pairs', `${name}.json`), 'utf-8')
    );
  }

  // Oracle: each fixture's hand-written expectedPairs and expectedExcluded
  it.each(['knockout-four-candidates', 'knockout-tie-middle', 'rows-sharing-prompt'])(
    '%s: one row per left/right pair, in judgement order',
    async (name) => {
      const fixture = loadFixture(name);
      const source = createMockJsonlSource(fixture.records);
      const decisions = new Map(Object.entries(fixture.decisions));

      const result = await buildExport('pairs.jsonl', {
        source,
        decisions,
        format: fixture.format,
        record: createRecordFn(fixture.records),
      });

      const rows = (await blobToString(result.blob))
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
      expect(rows).toEqual(fixture.expectedPairs);
      expect(result.stats.tiesExcluded).toBe(fixture.expectedExcluded.ties);
      expect(result.stats.bothBadExcluded).toBe(fixture.expectedExcluded.bothBad);

      const preview = computeExportStats('pairs.jsonl', source, decisions, fixture.format, {});
      expect(preview.pairsCount).toBe(fixture.expectedPairs.length);
      expect(preview.tiesExcluded).toBe(fixture.expectedExcluded.ties);
      expect(preview.bothBadExcluded).toBe(fixture.expectedExcluded.bothBad);
    }
  );
});

describe('all.decisions.jsonl exclude unparseable (D-022)', () => {
  it('all.decisions.jsonl leaves out unparseable lines when asked (D-022)', async () => {
    // tests/fixtures/jsonl/malformed.jsonl, its unparseable lines as malformed.meta.json declares
    const dir = join(import.meta.dirname, 'fixtures', 'jsonl');
    const meta = JSON.parse(readFileSync(join(dir, 'malformed.meta.json'), 'utf-8'));
    const lines = readFileSync(join(dir, 'malformed.jsonl'), 'utf-8').split('\n').slice(0, meta.lineCount);
    const bad = (meta.parseable as boolean[]).flatMap((ok, i) => (ok ? [] : [i]));
    expect(bad).toEqual([1]);
    const source = createMockJsonlSource(lines.map(() => null), bad);
    const record = async (i: number): Promise<ParsedRecord> =>
      bad.includes(i)
        ? { index: i, ok: false, error: 'Unexpected end', raw: lines[i] }
        : { index: i, ok: true, data: { valid: true } };
    const format: RecordFormat = { kind: 'unknown' };
    const decisions = new Map<CandidateRef, Decision>();

    const result = await buildExport('all.decisions.jsonl', {
      source,
      decisions,
      format,
      record,
      opts: { excludeUnparseable: true },
    });
    const preview = computeExportStats('all.decisions.jsonl', source, decisions, format, {
      excludeUnparseable: true,
    });

    expect(await blobToString(result.blob)).toBe(
      '{"valid":true,"_triage":{"status":"unreviewed","edited":false,"updatedAt":0}}\n'
    );
    expect(result.stats.lineCount).toBe(1);
    expect(result.stats.unparseableExcluded).toBe(1);
    expect(preview.lineCount).toBe(1);
  });
});

describe('all.decisions.jsonl non-object records (D-023)', () => {
  it('all.decisions.jsonl keeps a non-object record (D-023)', async () => {
    const records: unknown[] = [5, [1, 2], null, 'abc'];
    const source = createMockJsonlSource(records);

    const result = await buildExport('all.decisions.jsonl', {
      source,
      decisions: new Map(),
      format: { kind: 'unknown' },
      record: createRecordFn(records),
    });

    expect(await blobToString(result.blob)).toBe(
      '{"_value":5,"_triage":{"status":"unreviewed","edited":false,"updatedAt":0}}\n' +
        '{"_value":[1,2],"_triage":{"status":"unreviewed","edited":false,"updatedAt":0}}\n' +
        '{"_value":null,"_triage":{"status":"unreviewed","edited":false,"updatedAt":0}}\n' +
        '{"_value":"abc","_triage":{"status":"unreviewed","edited":false,"updatedAt":0}}\n'
    );
  });
});

describe('all.decisions.jsonl edits applied (D-028)', () => {
  it('all.decisions.jsonl writes each record with its edits applied (D-028)', async () => {
    const flat = [{ instruction: 'q', output: 'red' }];
    const flatResult = await buildExport('all.decisions.jsonl', {
      source: createMockJsonlSource(flat),
      decisions: new Map<CandidateRef, Decision>([
        ['0', { status: 'unreviewed', edits: { output: 'crimson' }, updatedAt: 1000 }],
      ]),
      format: { kind: 'flat', promptPath: 'instruction', responsePath: 'output' },
      record: createRecordFn(flat),
    });
    expect(await blobToString(flatResult.blob)).toBe(
      '{"instruction":"q","output":"crimson","_triage":{"status":"unreviewed","edited":true,"updatedAt":1000}}\n'
    );
  });

  it('all.decisions.jsonl applies an edit made under an in-record ref and marks the line edited (D-028)', async () => {
    const inRecord = [{ q: 'x', c: ['a', 'b'] }];
    const source = createMockJsonlSource(inRecord);
    source.index.candidates = Uint16Array.of(2);
    const inRecordResult = await buildExport('all.decisions.jsonl', {
      source,
      decisions: new Map<CandidateRef, Decision>([
        ['0:1', { status: 'unreviewed', edits: { 'c[1]': 'B' }, updatedAt: 1000 }],
      ]),
      format: { kind: 'candidates', promptPath: 'q', candidatesPath: 'c' },
      record: createRecordFn(inRecord),
    });
    expect(await blobToString(inRecordResult.blob)).toBe(
      '{"q":"x","c":["a","B"],"_triage":{"status":"unreviewed","edited":true,"updatedAt":0,' +
        '"candidates":{"1":{"status":"unreviewed","edited":true,"updatedAt":1000}}}}\n'
    );
  });
});
