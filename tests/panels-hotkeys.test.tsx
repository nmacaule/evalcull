/**
 * WP 6b: the panel keys M, L, N, G and / (PRD §2.2) in the App.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import App from '../src/App';
import { useReviewStore } from '../src/store/useReviewStore';
import { makeSource, press, loadSource, card, resetStore, FLAT_IO } from './helpers/app';
import type { RecordFormat } from '../src/types';

const FOUR = [
  '{"instruction":"P","output":"a","model":"m1"}',
  '{"instruction":"P","output":"b","model":"m2"}',
  '{"instruction":"P","output":"c","model":"m3"}',
  '{"instruction":"Q","output":"d","model":"m4"}',
];

const ROWS: RecordFormat = { kind: 'flat', promptPath: 'p', responsePath: 'r' };

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderFour() {
  await loadSource(makeSource(FOUR, [0, 0, 0, 1], [1, 1, 1, 1]), FLAT_IO);
  const view = render(<App />);
  await waitFor(() => expect(card(view.container, '1').textContent).toContain('b'));
  return view;
}

describe('M, L and N', () => {
  it('M toggles the metadata panel for the focused card', async () => {
    await renderFour();
    press('m', 'KeyM');
    expect(screen.getByRole('region', { name: 'Metadata' }).textContent).toContain('m1');
    press('m', 'KeyM');
    expect(screen.queryByRole('region', { name: 'Metadata' })).toBeNull();
  });

  it('L focuses the labels field and N the notes field; a letter typed there never decides', async () => {
    await renderFour();
    press('l', 'KeyL');
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Labels'));
    fireEvent.keyDown(document.activeElement!, { key: 'a', code: 'KeyA' });
    expect(useReviewStore.getState().decisions.size).toBe(0);
    press('Escape', 'Escape', {}, document.activeElement!);
    await waitFor(() => expect(screen.queryByLabelText('Labels')).toBeNull());

    press('n', 'KeyN');
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Notes'));
  });

  it('Mod+Enter saves labels, score and notes on the focused ref, and U undoes them to empty', async () => {
    await renderFour();
    press('l', 'KeyL');
    const labels = await screen.findByLabelText('Labels');
    fireEvent.change(labels, { target: { value: 'x' } });
    fireEvent.keyDown(labels, { key: 'Enter', code: 'Enter' });
    fireEvent.change(labels, { target: { value: 'y' } });
    fireEvent.keyDown(labels, { key: ',', code: 'Comma' });
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'n' } });
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter', code: 'Enter', metaKey: true });

    await waitFor(() => expect(screen.queryByLabelText('Labels')).toBeNull());
    const d = useReviewStore.getState().decisions.get('0');
    expect(d?.labels).toEqual(['x', 'y']);
    expect(d?.score).toBe(3);
    expect(d?.notes).toBe('n');

    press('u', 'KeyU');
    expect(useReviewStore.getState().decisions.get('0')?.notes).toBeUndefined();
    expect(useReviewStore.getState().decisions.get('0')?.score).toBe(3);
    press('u', 'KeyU');
    expect(useReviewStore.getState().decisions.get('0')?.score).toBeUndefined();
    press('u', 'KeyU');
    expect(useReviewStore.getState().decisions.has('0')).toBe(false);
  });
});

describe('G', () => {
  it('goes to a prompt, to the next unreviewed on empty, and refuses a number out of range', async () => {
    await renderFour();

    press('g', 'KeyG');
    const field = await screen.findByLabelText('Prompt number');
    fireEvent.change(field, { target: { value: '2' } });
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
    expect(useReviewStore.getState().cursor).toBe(1);

    act(() => useReviewStore.getState().goTo(0));
    press('g', 'KeyG');
    fireEvent.keyDown(await screen.findByLabelText('Prompt number'), { key: 'Enter', code: 'Enter' });
    expect(useReviewStore.getState().cursor).toBe(1);

    press('g', 'KeyG');
    const again = await screen.findByLabelText('Prompt number');
    fireEvent.change(again, { target: { value: '9' } });
    fireEvent.keyDown(again, { key: 'Enter', code: 'Enter' });
    expect(screen.getByText('Enter 1 to 2.')).toBeInTheDocument();
  });
});

describe('/ search', () => {
  async function search(query: string) {
    press('/', 'Slash');
    const field = await screen.findByLabelText('Search');
    fireEvent.change(field, { target: { value: query } });
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
  }

  it('moves to the prompt of the matching line, and says when nothing matches', async () => {
    await renderFour();
    expect(screen.queryByText("Searches the file's raw text.")).toBeNull();

    await search('"d"');
    await waitFor(() => expect(useReviewStore.getState().cursor).toBe(1));
    expect(screen.getByText("Searches the file's raw text.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(screen.getByText('No match.')).toBeInTheDocument());
  });

  it("keeps the cursor when the only match is another line of the current prompt, and finds another prompt's line first", async () => {
    const lines = ['{"p":"P","r":"x"}', '{"p":"Q","r":"y"}', '{"p":"P","r":"needle"}'];
    await loadSource(makeSource(lines, [0, 1, 0], [1, 1, 1]), ROWS);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '2').textContent).toContain('needle'));

    await search('needle');
    await waitFor(() => expect(screen.getByText('Only match is in this prompt.')).toBeInTheDocument());
    expect(useReviewStore.getState().cursor).toBe(0);

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '"r":"' } });
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(useReviewStore.getState().cursor).toBe(1));
  });

  it('maps a match to its line by bytes when an earlier line holds a multi-byte character', async () => {
    // The needle opens line 2, after a line of six bytes but three characters:
    // a slice by character offset would start three characters late and miss it
    const lines = ['{"p":"a","r":"x"}', '{"p":"ééé","r":"y"}', '{"p":"b","r":"z"}'];
    await loadSource(makeSource(lines, [0, 1, 2], [1, 1, 1]), ROWS);
    render(<App />);
    await waitFor(() => expect(screen.getByText('Record 1 of 3')).toBeInTheDocument());

    await search('{"p":"b"');
    await waitFor(() => expect(useReviewStore.getState().cursor).toBe(2));
  });

  it('a slow search left with J does not move the cursor afterwards (stale generation)', async () => {
    const lines = Array.from({ length: 12_000 }, (_, i) =>
      i === 11_000 ? '{"p":"z","r":"needle"}' : `{"p":"${i}","r":"x"}`
    );
    const run = async (leaveWithJ: boolean) => {
      resetStore();
      await loadSource(makeSource(lines, lines.map((_, i) => i), lines.map(() => 1)), ROWS);
      const view = render(<App />);
      await waitFor(() => expect(screen.getByText('Record 1 of 12000')).toBeInTheDocument());
      // The field is found on the real clock: findBy polls with setTimeout
      press('/', 'Slash');
      const field = await screen.findByLabelText('Search');
      fireEvent.change(field, { target: { value: 'needle' } });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
      // Let the first run of 5,000 lines finish and reach its yield
      await act(async () => {
        for (let i = 0; i < 50; i++) await Promise.resolve();
      });
      if (leaveWithJ) {
        // In a browser J types into a focused field, so focus leaves it first
        act(() => (document.activeElement as HTMLElement).blur());
        press('j', 'KeyJ');
      }
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      vi.useRealTimers();
      const cursor = useReviewStore.getState().cursor;
      view.unmount();
      return cursor;
    };

    // Control: left alone, the search reaches line 11,000
    expect(await run(false)).toBe(11_000);
    // Left with J after the first yield, the cursor stays where J put it
    expect(await run(true)).toBe(1);
  });
});
