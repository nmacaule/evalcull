/**
 * WP 6b: the Export panel's texts and downloads (PRD §2.10, §2.4; owner Q3).
 * Every expected text is written by hand; expected bytes come from the fixture
 * through Node's Buffer, not from the exporter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { ExportPanel } from '../src/components/ExportPanel';
import { useReviewStore } from '../src/store/useReviewStore';
import { makeSource, loadSource, resetStore, FLAT_IO, type JsonlSource } from './helpers/app';
import type { FileIndex, RecordFormat } from '../src/types';

const CAVEAT =
  'a DPO row needs one chosen and one rejected completion for the same prompt. Strength is carried in all.decisions.jsonl only.';
const EDITS_CAVEAT =
  'Edit pairs are off-policy: the chosen side was written by a person, not sampled from the model. DPO is sensitive to that distribution shift, and human-written chosen text can teach a length or style bias. Use them knowingly.';

const FOUR = [
  '{"instruction":"P","output":"a"}',
  '{"instruction":"P","output":"b"}',
  '{"instruction":"P","output":"c"}',
  '{"instruction":"Q","output":"d"}',
];

const row = (name: string) => within(screen.getByRole('region', { name }));

let created: Blob[] = [];
let downloads: string[] = [];

beforeEach(() => {
  resetStore();
  created = [];
  downloads = [];
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        created.push(blob);
        return 'blob:test';
      });
      static revokeObjectURL = vi.fn();
    }
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Export panel texts', () => {
  it('counts pairs and the ties and both-unacceptable pairs left out, singular for 1', async () => {
    await loadSource(makeSource(FOUR, [0, 0, 0, 1], [1, 1, 1, 1]), FLAT_IO);
    const store = useReviewStore.getState();
    store.prefer('left');
    store.prefer('tie');
    useReviewStore.getState().decide('3', 'kept');
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    expect(
      row('pairs.jsonl').getByText(`1 pair. 1 tie and 0 both-unacceptable pairs were left out: ${CAVEAT}`)
    ).toBeInTheDocument();
    expect(row('pairs.jsonl').getByText('Keep and Reject decisions alone never produce a preference pair.')).toBeInTheDocument();
  });

  it('pluralises 2 ties and keeps 1 both-unacceptable pair singular', async () => {
    const six = [
      '{"instruction":"P","output":"a"}',
      '{"instruction":"P","output":"b"}',
      '{"instruction":"P","output":"c"}',
      '{"instruction":"R","output":"d"}',
      '{"instruction":"R","output":"e"}',
      '{"instruction":"R","output":"f"}',
    ];
    await loadSource(makeSource(six, [0, 0, 0, 1, 1, 1], [1, 1, 1, 1, 1, 1]), FLAT_IO);
    for (const p of ['left', 'tie', 'tie', 'both_bad'] as const) useReviewStore.getState().prefer(p);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    expect(
      row('pairs.jsonl').getByText(`1 pair. 2 ties and 1 both-unacceptable pair were left out: ${CAVEAT}`)
    ).toBeInTheDocument();
  });

  it('says how many rows use the implicit-prompt format', async () => {
    const preference: RecordFormat = { kind: 'preference', chosenPath: 'chosen', rejectedPath: 'rejected' };
    await loadSource(
      makeSource(['{"chosen":"a","rejected":"b"}', '{"chosen":"c","rejected":"d"}'], [0, 1], [2, 2]),
      preference
    );
    useReviewStore.getState().prefer('left');
    useReviewStore.getState().prefer('left');
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    expect(
      row('pairs.jsonl').getByText("2 rows have no prompt field and use TRL's implicit-prompt format.")
    ).toBeInTheDocument();
  });

  it('shows the edit-pairs caveat verbatim and the all.decisions.jsonl text', async () => {
    await loadSource(makeSource(FOUR, [0, 0, 0, 1], [1, 1, 1, 1]), FLAT_IO);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    expect(row('pairs.edits.jsonl').getByText('0 pairs from edits.')).toBeInTheDocument();
    expect(row('pairs.edits.jsonl').getByText(EDITS_CAVEAT)).toBeInTheDocument();
    expect(
      row('all.decisions.jsonl').getByText(
        'Every record with its edits applied and its _triage decisions. Re-serialised; the original stays in the source file.'
      )
    ).toBeInTheDocument();
    expect(
      row('kept.jsonl').getByText(
        'Unedited lines are copied byte for byte, including line endings. Only the lines you edited are re-serialised.'
      )
    ).toBeInTheDocument();
  });

  it('badges a BOM and offers to exclude unparseable lines only when there are some', async () => {
    // Sources over the lf, bom and malformed fixtures, flags as their .meta.json declare
    const fromFixture = (name: string) => {
      const text = readFileSync(join(import.meta.dirname, 'fixtures/jsonl', `${name}.jsonl`), 'utf-8');
      const meta = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/jsonl', `${name}.meta.json`), 'utf-8'));
      const lines = text.replace(/^\uFEFF/, '').split('\n').slice(0, meta.lineCount);
      const unparseable = (meta.parseable as boolean[]).flatMap((ok, i) => (ok ? [] : [i]));
      const source = makeSource(lines, lines.map((_, i) => i), lines.map(() => 1), { unparseable });
      source.index.hasBom = meta.hasBom;
      return source;
    };
    const unknown: RecordFormat = { kind: 'unknown' };

    await loadSource(fromFixture('lf'), unknown);
    const lf = render(<ExportPanel open={true} onOpenChange={() => {}} />);
    expect(screen.queryByText('BOM present')).toBeNull();
    expect(screen.queryByText(/^Exclude /)).toBeNull();
    lf.unmount();

    await loadSource(fromFixture('bom'), unknown);
    const bom = render(<ExportPanel open={true} onOpenChange={() => {}} />);
    expect(screen.getByText('BOM present')).toBeInTheDocument();
    expect(screen.queryByText(/^Exclude /)).toBeNull();
    bom.unmount();

    await loadSource(fromFixture('malformed'), unknown);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    expect(screen.queryByText('BOM present')).toBeNull();
    expect(screen.getByText('Exclude 1 unparseable line')).toBeInTheDocument();
  });
});

describe('Export panel downloads', () => {
  it('downloads pairs.jsonl under its own name', async () => {
    await loadSource(makeSource(FOUR, [0, 0, 0, 1], [1, 1, 1, 1]), FLAT_IO);
    useReviewStore.getState().prefer('left');
    useReviewStore.getState().prefer('tie');
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download pairs.jsonl' }));

    await waitFor(() => expect(downloads).toEqual(['pairs.jsonl']));
    expect(created).toHaveLength(1);
    expect(
      row('pairs.jsonl').getByText(`1 pair. 1 tie and 0 both-unacceptable pairs were left out: ${CAVEAT}`)
    ).toBeInTheDocument();
  });

  it('replaces the preview with the exact stats after a download', async () => {
    // The preview counts a judged pair on an unparseable line; the export leaves it out
    await loadSource(makeSource(FOUR, [0, 0, 0, 1], [1, 1, 1, 1], { unparseable: [1] }), FLAT_IO);
    useReviewStore.getState().prefer('left');
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(
      row('pairs.jsonl').getByText(`1 pair. 0 ties and 0 both-unacceptable pairs were left out: ${CAVEAT}`)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download pairs.jsonl' }));

    await waitFor(() =>
      expect(
        row('pairs.jsonl').getByText(`0 pairs. 0 ties and 0 both-unacceptable pairs were left out: ${CAVEAT}`)
      ).toBeInTheDocument()
    );
  });

  it('kept.jsonl with BOM strip is the fixture without its first three bytes', async () => {
    const bytes = readFileSync(join(import.meta.dirname, 'fixtures/jsonl/bom.jsonl'));
    const meta = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/jsonl/bom.meta.json'), 'utf-8'));
    // Offsets from Buffer.indexOf(0x0A), starts[0] = 0 so line 0 keeps the BOM
    const starts: number[] = [];
    const ends: number[] = [];
    let pos = 0;
    while (pos < bytes.length) {
      const nl = bytes.indexOf(0x0a, pos);
      starts.push(pos);
      ends.push(nl);
      pos = nl + 1;
    }
    const index: FileIndex = {
      fingerprint: 'bom-fp',
      lineCount: meta.lineCount,
      starts: Float64Array.from(starts),
      ends: Float64Array.from(ends),
      eols: Uint8Array.from(meta.eols),
      hasBom: meta.hasBom,
      groups: Uint32Array.from(starts.map((_, i) => i)),
      groupCount: meta.lineCount,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array(meta.lineCount).fill(1),
    };
    const slice = (from: number, to: number) => bytes.subarray(starts[from], ends[to] + 1);
    const source: JsonlSource = {
      kind: 'jsonl',
      index,
      readText: async (i) => new TextDecoder().decode(bytes.subarray(i === 0 ? 3 : starts[i], ends[i])),
      readRaw: async (i) => new Blob([slice(i, i)]),
      readRawRange: async (from, to) => new Blob([slice(from, to)]),
    };
    await loadSource(source, { kind: 'unknown' });
    for (let i = 0; i < meta.lineCount; i++) useReviewStore.getState().decide(String(i), 'kept');
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: 'strip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download kept.jsonl' }));

    await waitFor(() => expect(downloads).toEqual(['kept.jsonl']));
    const out = Buffer.from(await created[0].arrayBuffer());
    expect(out.equals(bytes.subarray(3))).toBe(true);
  });
});
