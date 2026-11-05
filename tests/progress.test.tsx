/**
 * WP 6b: the progress counter and the position line. Expected text written by hand.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import App from '../src/App';
import { useReviewStore } from '../src/store/useReviewStore';
import { makeSource, press, loadSource, resetStore, FLAT_IO } from './helpers/app';

beforeEach(() => {
  resetStore();
});

describe('position line', () => {
  it('single mode shows "Record 2 of 3" for three lines in two groups (D-020)', async () => {
    const source = makeSource(
      [
        '{"instruction":"p","output":"a"}',
        '{"instruction":"q","output":"b"}',
        '{"instruction":"p","output":"c"}',
      ],
      [0, 1, 0],
      [1, 1, 1]
    );
    await loadSource(source, FLAT_IO);
    useReviewStore.getState().setMode('single');
    useReviewStore.getState().goTo(1);
    render(<App />);

    await waitFor(() => expect(screen.getByText('Record 2 of 3')).toBeInTheDocument());
  });
});

// Prompts P (lines 0, 1, 2) and Q (line 3)
const FOUR = [
  '{"instruction":"P","output":"a"}',
  '{"instruction":"P","output":"b"}',
  '{"instruction":"P","output":"c"}',
  '{"instruction":"Q","output":"d"}',
];

const progressText = () => screen.getByTestId('progress-text').textContent;

describe('progress counter (PRD §2.8)', () => {
  it('counts judged pairs and candidates in compare mode, zeros included', async () => {
    await loadSource(makeSource(FOUR, [0, 0, 0, 1], [1, 1, 1, 1]), FLAT_IO);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('progress-text')).toBeInTheDocument());

    expect(progressText()).toBe(
      '0 / 2 prompts · 0 left · 0 right · 0 tie · 0 both bad · 0 kept · 0 rejected · 0 skipped · 0 edited'
    );

    press('ArrowLeft', 'ArrowLeft');
    press('=', 'Equal');
    await waitFor(() => expect(useReviewStore.getState().cursor).toBe(1));
    press('a', 'KeyA');

    await waitFor(() =>
      expect(progressText()).toBe(
        '2 / 2 prompts · 1 left · 0 right · 1 tie · 0 both bad · 1 kept · 0 rejected · 0 skipped · 0 edited'
      )
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
  });

  it('groups thousands', async () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `{"instruction":"p${i}","output":"r"}`);
    await loadSource(
      makeSource(lines, lines.map((_, i) => i), lines.map(() => 1)),
      FLAT_IO
    );
    useReviewStore.getState().setMode('compare');
    render(<App />);

    await waitFor(() => expect(progressText()!.startsWith('0 / 2,000 prompts')).toBe(true));
  });

  it('counts records in single mode', async () => {
    await loadSource(makeSource(FOUR, [0, 0, 0, 1], [1, 1, 1, 1]), FLAT_IO);
    useReviewStore.getState().setMode('single');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('progress-text')).toBeInTheDocument());

    press('a', 'KeyA');

    await waitFor(() =>
      expect(progressText()).toBe('1 / 4 records · 1 kept · 0 rejected · 0 skipped · 0 edited')
    );
  });

  it('adds the unparseable count when there is one', async () => {
    // tests/fixtures/jsonl/malformed.jsonl, unparseable lines as its .meta.json declares
    const dir = join(import.meta.dirname, 'fixtures', 'jsonl');
    const meta = JSON.parse(readFileSync(join(dir, 'malformed.meta.json'), 'utf-8'));
    const lines = readFileSync(join(dir, 'malformed.jsonl'), 'utf-8').split('\n').slice(0, meta.lineCount);
    const unparseable = (meta.parseable as boolean[]).flatMap((ok, i) => (ok ? [] : [i]));
    await loadSource(
      makeSource(lines, lines.map((_, i) => i), lines.map(() => 1), { unparseable }),
      { kind: 'unknown' }
    );
    render(<App />);

    await waitFor(() => expect(progressText()!.endsWith(' · 1 unparseable')).toBe(true));
  });
});
