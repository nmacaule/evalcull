/**
 * WP 6b: opening another file by drop while a panel holds a draft (D-037).
 * loadJsonlFile is mocked to load a second source through the store's load().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import App from '../src/App';
import { useReviewStore } from '../src/store/useReviewStore';
import { makeSource, press, loadSource, card, resetStore, FLAT_IO, MESSAGES } from './helpers/app';
import { configureSidecar, configureStorage } from '../src/store/persistence';

// Loads of a dropped file: each loads a one-line source named after the file;
// while `held` is set, a load waits until the test releases it
const loads = vi.hoisted(() => ({
  held: false,
  waiting: [] as Array<{ name: string; release: () => void }>,
}));
vi.mock('../src/readers/loadJsonlFile', () => ({
  loadJsonlFile: async (file: File) => {
    const { makeSource: make, loadSource: load, FLAT_IO: flat } = await import('./helpers/app');
    if (loads.held) {
      await new Promise<void>((release) => loads.waiting.push({ name: file.name, release }));
    }
    await load(
      make([`{"instruction":"${file.name}","output":"x"}`], [0], [1], { fingerprint: `fp-${file.name}` }),
      flat
    );
  },
}));

async function release(name: string) {
  const i = loads.waiting.findIndex((w) => w.name === name);
  const [w] = loads.waiting.splice(i, 1);
  await act(async () => {
    w.release();
    for (let k = 0; k < 20; k++) await Promise.resolve();
  });
}

beforeEach(() => {
  resetStore();
  loads.held = false;
  loads.waiting = [];
});

function drop(name: string) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['{}\n'], name)] } });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('drop while the label and notes panel is open', () => {
  it('a notes draft on one file is never saved to the next (D-037)', async () => {
    await loadSource(makeSource(['{"instruction":"a","output":"ay"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('ay'));

    press('n', 'KeyN');
    fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: 'draft for a' } });
    drop('b.jsonl');
    const refused = screen.queryByText('Save or cancel the labels and notes first.') !== null;
    const confirmShown = screen.queryByText('Open b.jsonl? Changes to the current file are saved first.') !== null;
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const { fingerprint, decisions } = useReviewStore.getState();

    // The drop is refused while the panel is open, and the draft is saved to the file it was typed for
    expect({ refused, confirmShown, fingerprint, notes: decisions.get('0')?.notes }).toEqual({
      refused: true,
      confirmShown: false,
      fingerprint: 'fp-a',
      notes: 'draft for a',
    });
  });

  it('nothing opens while another file is opening, and no panel is left open on the new file (D-038)', async () => {
    await loadSource(makeSource(['{"instruction":"a","output":"ay"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('ay'));
    loads.held = true;

    drop('b.jsonl');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(loads.waiting).toHaveLength(1));
    press('n', 'KeyN');
    // While the file is opening the app is modal: N opens nothing
    expect(screen.queryByLabelText('Notes')).toBeNull();
    await release('b.jsonl');
    await waitFor(() => expect(useReviewStore.getState().fingerprint).toBe('fp-b.jsonl'));

    expect(screen.queryByLabelText('Notes')).toBeNull();
  });

  it('a file opened by other means closes the panel left open on the previous one (D-038)', async () => {
    await loadSource(makeSource(['{"instruction":"a","output":"ay"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('ay'));
    press('n', 'KeyN');
    await screen.findByLabelText('Notes');

    await act(async () => {
      await loadSource(makeSource(['{"instruction":"b","output":"bee"}'], [0], [1], { fingerprint: 'fp-b' }), FLAT_IO);
    });

    expect(screen.queryByLabelText('Notes')).toBeNull();
  });

  it('a drop while the mapping modal holds a draft is refused (D-044)', async () => {
    await loadSource(makeSource(['{"instruction":"a","output":"ay"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('ay'));
    fireEvent.click(screen.getByRole('button', { name: 'Configure format' }));
    // A changed field: from here the modal holds a draft (D-069)
    fireEvent.change(await screen.findByLabelText('Response Path'), { target: { value: 'drafted.for.a' } });

    drop('b.jsonl');

    expect({
      refused: screen.queryByText('Apply or cancel the format first.') !== null,
      confirm: screen.queryByText('Open b.jsonl? Changes to the current file are saved first.') !== null,
    }).toEqual({ refused: true, confirm: false });
  });

  it('a second drop while a file is opening is refused (D-039)', async () => {
    await loadSource(makeSource(['{"instruction":"a","output":"ay"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('ay'));
    loads.held = true;

    drop('b.jsonl');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(loads.waiting).toHaveLength(1));
    drop('c.jsonl');

    expect({
      refused: screen.queryByText('Wait for b.jsonl to open.') !== null,
      confirm: screen.queryByText('Open c.jsonl? Changes to the current file are saved first.') !== null,
    }).toEqual({ refused: true, confirm: false });
  });
});

describe('a request while a switch is opening', () => {
  it('a format change requested while another file opens says so (D-056)', async () => {
    await loadSource(makeSource(['{"instruction":"a","output":"ay"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('ay'));
    // A load of b.jsonl whose session read never answers: the switch stays opening
    configureSidecar({ token: 'tok', transport: { get: () => new Promise(() => {}), put: vi.fn() } });
    act(() => {
      useReviewStore.getState().load(makeSource(['{"instruction":"b","output":"bee"}'], [0], [1], { fingerprint: 'fp-b' }), {
        sourceName: 'b.jsonl',
        fingerprint: 'fp-b',
        format: FLAT_IO,
      });
    });

    // Configure format is disabled meanwhile (D-055); the request itself is refused, and says so
    expect(screen.getByRole('button', { name: 'Configure format' })).toBeDisabled();
    await act(async () => {
      await useReviewStore.getState().setFormat({ kind: 'flat', promptPath: 'output', responsePath: 'instruction' });
    });

    expect(screen.getByText('Wait for b.jsonl to open.')).toBeInTheDocument();
  });
});

describe('Open anyway with an edit open', () => {
  it('Open anyway, discarding changes, never discards an edit being typed (D-064)', async () => {
    configureStorage({ indexedDB: undefined });
    await loadSource(makeSource(['{"instruction":"a","output":"ay"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('ay'));
    // Neither sink: a change, then the switch to fp-b is cancelled and held
    act(() => useReviewStore.getState().decide('0', 'kept'));
    await act(async () => {
      await loadSource(makeSource(['{"instruction":"b","output":"bee"}'], [0], [1], { fingerprint: 'fp-b' }), FLAT_IO);
    });
    press('e', 'KeyE');
    fireEvent.change(screen.getByLabelText('Edit content'), { target: { value: 'typed draft' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway, discarding changes' }));
    });

    expect({
      fingerprint: useReviewStore.getState().fingerprint,
      draft: (screen.queryByLabelText('Edit content') as HTMLTextAreaElement | null)?.value,
    }).toEqual({ fingerprint: 'fp-a', draft: 'typed draft' });
  });
});

describe('a file whose format is unknown', () => {
  it('after the mapping modal is cancelled, another file can still be opened (D-069)', async () => {
    await loadSource(makeSource(['{"x":1}'], [0], [1], { fingerprint: 'fp-a' }), { kind: 'unknown' });
    render(<App />);
    // The mapping modal opens by itself for an unknown format; the user cancels it
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    drop('b.jsonl');

    expect({
      refused: screen.queryByText('Apply or cancel the format first.') !== null,
      confirm: screen.queryByText('Open b.jsonl? Changes to the current file are saved first.') !== null,
    }).toEqual({ refused: false, confirm: true });
  });
});

describe('a mouse click while another file is opening', () => {
  it('a click on a conversation turn opens no editor while a file is opening (D-072)', async () => {
    const conversation =
      '{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"a1"}]}';
    await loadSource(makeSource([conversation], [0], [1], { fingerprint: 'fp-a' }), MESSAGES);
    render(<App />);
    await waitFor(() => expect(screen.getByText('a1')).toBeInTheDocument());
    loads.held = true;

    drop('b.jsonl');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(loads.waiting).toHaveLength(1));
    fireEvent.click(screen.getByText('a1').closest('[role="button"]')!);
    const editorOpened = screen.queryByLabelText('Edit content') !== null;
    await release('b.jsonl');

    expect(editorOpened).toBe(false);
  });
});
