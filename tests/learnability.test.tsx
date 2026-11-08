/**
 * Learnability surfaces (WP 7d): the empty state (DR-031), the resume cue (DR-034), the
 * action bar (DR-028) and the first-use hints (DR-030). Oracle: the owner-ruled texts and
 * PRD §2.2's actions, written by hand; each click is checked against the store or the page.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import App from '../src/App';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage } from '../src/store/persistence';
import { makeSource, press, loadSource, card, resetStore, FLAT_IO } from './helpers/app';
import type { RecordFormat } from '../src/types';

const CANDIDATES: RecordFormat = { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'responses' };
const FOUR = ['{"prompt":"p","responses":["w w","x x","y y","z z"]}', '{"prompt":"q","responses":["a","b"]}'];
const PAIRS = ['{"prompt":"p1","responses":["a","b"]}', '{"prompt":"p2","responses":["c","d"]}', '{"prompt":"p3","responses":["e","f"]}'];
const ONE = ['{"prompt":"p","responses":["only"]}', '{"prompt":"q","responses":["a","b"]}'];
const FLAT_TWO = ['{"instruction":"q one","output":"a one"}', '{"instruction":"q two","output":"a two"}'];

const state = () => useReviewStore.getState();
const bar = () => screen.getByRole('region', { name: 'Review actions' });
const button = (name: RegExp) => within(bar()).getByRole('button', { name });

async function open(lines: string[], groups: number[], candidates: number[], format: RecordFormat, ready: [string, string]) {
  await loadSource(makeSource(lines, groups, candidates), format);
  const view = render(<App />);
  await waitFor(() => expect(card(view.container, ready[0]).textContent).toContain(ready[1]));
  return view;
}
const compareFour = () => open(FOUR, [0, 1], [4, 2], CANDIDATES, ['0:1', 'x']);
const single = () => open(FLAT_TWO, [0, 1], [1, 1], FLAT_IO, ['0', 'a one']);

beforeEach(() => {
  resetStore();
  localStorage.clear();
});

describe('the empty state (DR-031)', () => {
  it('says what evalcull does and produces, and gives each sample its task', () => {
    render(<App />);
    expect(screen.getByText('Review model responses in a JSONL file: pick the better of two, keep or reject, and fix the text.')).toBeInTheDocument();
    expect(
      screen.getByText('You get pairs.jsonl for preference tuning, kept.jsonl for fine-tuning and all.decisions.jsonl with every decision. Nothing leaves your computer.')
    ).toBeInTheDocument();
    expect(screen.getByText('Drop a JSONL file anywhere on this page, or open one.')).toBeInTheDocument();
    expect(screen.getByText('pick the best response for each prompt')).toBeInTheDocument();
    expect(screen.getByText('review chat transcripts one by one')).toBeInTheDocument();
    expect(screen.getByText('check chosen and rejected pairs')).toBeInTheDocument();
    // The samples keep their names (DR-031, SC 2.5.3)
    expect(screen.getByRole('button', { name: 'Open sample: candidates' })).toBeInTheDocument();
  });
});

describe('the resume cue (DR-034)', () => {
  async function restored() {
    const factory = new IDBFactory();
    configureStorage({ indexedDB: factory });
    // Prompt 2 judged, the cursor left on prompt 3; prompt 1 unreviewed
    const source = makeSource(PAIRS, [0, 1, 2], [2, 2, 2], { fingerprint: 'resume-fp' });
    await loadSource(source, CANDIDATES);
    state().goTo(1);
    state().prefer('left');
    expect(state().cursor).toBe(2);
    const text = state().exportSession();
    // Reopen the same file with that session in IndexedDB
    resetStore();
    configureStorage({ indexedDB: factory });
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('evalcull', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sessions');
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(text, 'resume-fp');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    await loadSource(makeSource(PAIRS, [0, 1, 2], [2, 2, 2], { fingerprint: 'resume-fp' }), CANDIDATES);
    expect(state().session.kind).toBe('restored');
    const view = render(<App />);
    await waitFor(() => expect(card(view.container, '2:0').textContent).toContain('e'));
    return view;
  }

  it('the status region is in the page before the session is restored, and gets the sentence after (DR-034)', async () => {
    const factory = new IDBFactory();
    configureStorage({ indexedDB: factory });
    await loadSource(makeSource(PAIRS, [0, 1, 2], [2, 2, 2], { fingerprint: 'early-fp' }), CANDIDATES);
    state().prefer('left');
    const text = state().exportSession();
    resetStore();
    configureStorage({ indexedDB: factory });
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('evalcull', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sessions');
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(text, 'early-fp');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    // The empty screen: the region is there, empty
    render(<App />);
    const region = document.querySelector('[data-resume-status]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region!.textContent).toBe('');
    // The file opens with its saved session: the same element now holds the sentence
    await act(async () => {
      await loadSource(makeSource(PAIRS, [0, 1, 2], [2, 2, 2], { fingerprint: 'early-fp' }), CANDIDATES);
    });
    expect(state().session.kind).toBe('restored');
    await waitFor(() => expect(region!.textContent).toMatch(/^Resumed where you left off/));
    expect(document.querySelector('[data-resume-status]')).toBe(region);
    // The buttons sit outside the status region
    expect(within(region as HTMLElement).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Go to first unreviewed' })).toBeInTheDocument();
  });

  it('says the session was resumed, where and how far, in a status line', async () => {
    await restored();
    const sentence = 'Resumed where you left off: prompt 3 of 3. 1 of 3 prompts done.';
    // Announced through the shell's hidden status region
    const region = document.querySelector('[data-resume-status]');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent(sentence);
    // Shown under the header as ordinary content, not a live region
    const line = document.querySelector('[data-resume-line]');
    expect(line).toHaveTextContent(sentence);
    expect(line!.closest('[role="status"], [aria-live]')).toBeNull();
    expect(line!.closest('header')).not.toBeNull();
  });

  it('Go to first unreviewed goes to the first unreviewed prompt, and Dismiss removes the line', async () => {
    await restored();
    fireEvent.click(screen.getByRole('button', { name: 'Go to first unreviewed' }));
    expect(state().cursor).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Resumed where you left off/)).toBeNull();
  });

  it('Go to first unreviewed finds the first unreviewed prompt from the top, not the next one (DR-034 amendment)', async () => {
    const factory = new IDBFactory();
    configureStorage({ indexedDB: factory });
    // Prompt 2 judged and the cursor put back on it; prompts 1 and 3 unreviewed
    await loadSource(makeSource(PAIRS, [0, 1, 2], [2, 2, 2], { fingerprint: 'first-fp' }), CANDIDATES);
    state().goTo(1);
    state().prefer('left');
    state().goTo(1);
    const text = state().exportSession();
    resetStore();
    configureStorage({ indexedDB: factory });
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('evalcull', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sessions');
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(text, 'first-fp');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    await loadSource(makeSource(PAIRS, [0, 1, 2], [2, 2, 2], { fingerprint: 'first-fp' }), CANDIDATES);
    expect(state().session.kind).toBe('restored');
    expect(state().cursor).toBe(1);
    const view = render(<App />);
    await waitFor(() => expect(card(view.container, '1:0').textContent).toContain('c'));
    fireEvent.click(screen.getByRole('button', { name: 'Go to first unreviewed' }));
    // The next-unreviewed jump would go to prompt 3 (cursor 2); the first unreviewed is prompt 1
    expect(state().cursor).toBe(0);
  });

  it('goes after a decision', async () => {
    await restored();
    press('ArrowLeft', 'ArrowLeft');
    await waitFor(() => expect(screen.queryByText(/Resumed where you left off/)).toBeNull());
  });

  it('is not shown for a file with no saved session', async () => {
    await compareFour();
    expect(screen.queryByText(/Resumed where you left off/)).toBeNull();
  });
});

describe('the action bar (DR-028)', () => {
  it('is a labelled region, never a group, so the cards stay the only groups', async () => {
    await compareFour();
    expect(bar()).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });

  it.each([
    [/^Left is better/, () => state().decisions.get('0')?.compare?.[0]?.preference === 'left'],
    [/^Right is better/, () => state().decisions.get('0')?.compare?.[0]?.preference === 'right'],
    [/^Tie/, () => state().decisions.get('0')?.compare?.[0]?.preference === 'tie'],
    [/^Both bad/, () => state().decisions.get('0')?.compare?.[0]?.preference === 'both_bad'],
    [/^Keep/, () => state().decisions.get('0:0')?.status === 'kept'],
    [/^Reject/, () => state().decisions.get('0:0')?.status === 'rejected'],
    [/^Skip/, () => state().decisions.get('0:0')?.status === 'skipped'],
    [/^Next/, () => state().cursor === 1],
    [/^Previous/, () => state().cursor === 1],
    [/^Filter/, () => state().filter !== 'all'],
    [/^Text size/, () => document.documentElement.hasAttribute('data-reading-step')],
  ])('in compare mode, %s does what its key does', async (name, acted) => {
    document.documentElement.removeAttribute('data-reading-step');
    await compareFour();
    fireEvent.click(button(name));
    await waitFor(() => expect(acted()).toBe(true));
  });

  it.each([
    [/^Edit/, () => screen.queryByLabelText('Edit content') !== null],
    [/^Raw/, (c: HTMLElement) => (card(c, '0:0').textContent ?? '').includes('"responses":')],
    [/^Whitespace/, (c: HTMLElement) => card(c, '0:0').querySelector('[data-ws-mark]') !== null],
    [/^Details/, () => screen.queryByRole('region', { name: 'Metadata' }) !== null],
    [/^Labels/, () => screen.queryByRole('dialog') !== null],
    [/^Notes/, () => screen.queryByRole('dialog') !== null],
    [/^Go to/, () => screen.queryByRole('dialog') !== null],
    [/^Search/, () => screen.queryByRole('textbox', { name: 'Search' }) !== null],
  ])('in compare mode, %s opens or shows what its key does', async (name, acted) => {
    const { container } = await compareFour();
    fireEvent.click(button(name));
    await waitFor(() => expect(acted(container)).toBe(true));
  });

  it('names the current filter on its Filter button, and the header no longer shows it (owner, 7 Nov 2026)', async () => {
    await compareFour();
    expect(screen.getByRole('banner')).not.toHaveTextContent('Filter:');
    expect(button(/^Filter: all/)).toBeInTheDocument();
    fireEvent.click(button(/^Filter/));
    expect(button(/^Filter: unreviewed/)).toBeInTheDocument();
  });

  it('Undo and Redo undo and redo', async () => {
    await compareFour();
    fireEvent.click(button(/^Keep/));
    fireEvent.click(button(/^Undo/));
    expect(state().decisions.get('0:0')?.status).toBeUndefined();
    fireEvent.click(button(/^Redo/));
    expect(state().decisions.get('0:0')?.status).toBe('kept');
  });

  it('offers strength after a judged pair, and marks the strength set', async () => {
    await compareFour();
    expect(within(bar()).queryByRole('button', { name: /^Much better/ })).toBeNull();
    fireEvent.click(button(/^Left is better/));
    fireEvent.click(await within(bar()).findByRole('button', { name: /^Better/ }));
    expect(state().decisions.get('0')?.compare?.[0]?.strength).toBe(2);
    expect(button(/^Better/)).toHaveAttribute('aria-pressed', 'true');
    expect(button(/^Much better/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows each key in a keycap and in aria-keyshortcuts', async () => {
    await compareFour();
    expect(button(/^Keep/)).toHaveAttribute('aria-keyshortcuts', 'A');
    expect(within(button(/^Keep/)).getByText('A')).toBeInTheDocument();
    expect(button(/^Left is better/)).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft 1');
  });

  it('with single-key shortcuts off, shows no character key but keeps the arrows', async () => {
    localStorage.setItem('evalcull.shortcuts', 'off');
    await compareFour();
    expect(button(/^Keep/)).not.toHaveAttribute('aria-keyshortcuts');
    expect(within(button(/^Keep/)).queryByText('A')).toBeNull();
    expect(button(/^Left is better/)).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft');
  });

  it('in single mode, offers no preference and acts on the record', async () => {
    await single();
    expect(within(bar()).queryByRole('button', { name: /^Left is better/ })).toBeNull();
    fireEvent.click(button(/^Keep/));
    expect(state().decisions.get('0')?.status).toBe('kept');
  });

  it('on a one-candidate prompt, disables the preferences', async () => {
    await open(ONE, [0, 1], [1, 2], CANDIDATES, ['0:0', 'only']);
    expect(button(/^Left is better/)).toBeDisabled();
    expect(button(/^Keep/)).toBeEnabled();
  });

  it('on an Other record, does not offer the raw-view toggle (D-113)', async () => {
    await open(['{"zz":1}', '{"zz":2}'], [0, 1], [1, 1], { kind: 'unknown' }, ['0', 'zz']);
    press('Escape', 'Escape');
    expect(within(bar()).queryByRole('button', { name: /^Raw/ })).toBeNull();
  });
});

describe('first-use hints (DR-030)', () => {
  const COMPARE_HINT = 'Which response is better? Press ← or →, or use the buttons below. = if both are good, X if both are bad.';
  const ROUND2_HINT = 'The response you preferred stays as Winner so far and meets the next one.';
  const SINGLE_HINT = 'Keep, reject or skip each record with A, R or S, or the buttons below.';

  it('the compare hint shows at the first pair, goes at the first judgement, and never again', async () => {
    const view = await compareFour();
    expect(screen.getByText(COMPARE_HINT)).toBeInTheDocument();
    press('ArrowLeft', 'ArrowLeft');
    await waitFor(() => expect(screen.queryByText(COMPARE_HINT)).toBeNull());
    view.unmount();
    resetStore();
    await compareFour();
    expect(screen.queryByText(COMPARE_HINT)).toBeNull();
  });

  it('the round-2 hint shows the first time an incumbent stays', async () => {
    await compareFour();
    expect(screen.queryByText(ROUND2_HINT)).toBeNull();
    press('ArrowLeft', 'ArrowLeft');
    expect(await screen.findByText(ROUND2_HINT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(ROUND2_HINT)).toBeNull();
  });

  it('the single hint goes with A, R or S', async () => {
    await single();
    expect(screen.getByText(SINGLE_HINT)).toBeInTheDocument();
    press('a', 'KeyA');
    await waitFor(() => expect(screen.queryByText(SINGLE_HINT)).toBeNull());
  });

  it('Got it dismisses a hint for good', async () => {
    const view = await single();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(SINGLE_HINT)).toBeNull();
    view.unmount();
    resetStore();
    await single();
    expect(screen.queryByText(SINGLE_HINT)).toBeNull();
  });

  it('shows nothing when local storage fails', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      clear: () => {},
    });
    try {
      await single();
      expect(screen.queryByText(SINGLE_HINT)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('browser preferences when storage fails (DR-029, DR-030)', () => {
  it('reads the switch as on and every hint as seen, and writes without throwing', async () => {
    const { readCharacterKeys, writeCharacterKeys, hintSeen, markHintSeen } = await import('../src/lib/preferences');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    try {
      expect(readCharacterKeys()).toBe(true);
      expect(hintSeen('compare')).toBe(true);
      expect(() => writeCharacterKeys(false)).not.toThrow();
      expect(() => markHintSeen('compare')).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
