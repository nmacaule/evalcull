/**
 * WP 6b: what the cards and panels show. Expected values are written by hand.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import App from '../src/App';
import { makeSource, press, loadSource, card, resetStore, FLAT_IO, MESSAGES } from './helpers/app';
import type { RecordFormat } from '../src/types';
import { useReviewStore } from '../src/store/useReviewStore';

beforeEach(() => {
  resetStore();
});

describe('cards (WP 6b defects)', () => {
  it('shows the prompt above the cards for a flat prompt group (D-013)', async () => {
    const source = makeSource(
      [
        '{"instruction":"Name a colour","output":"red"}',
        '{"instruction":"Name a colour","output":"blue"}',
      ],
      [0, 0],
      [1, 1]
    );
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);

    await waitFor(() => expect(card(container, '1').textContent).toContain('blue'));
    expect(screen.queryAllByText('Name a colour')).toHaveLength(1);
  });

  it('renders a non-string candidate with its digits as written (D-015)', async () => {
    const candidates: RecordFormat = { kind: 'candidates', promptPath: 'q', candidatesPath: 'c' };
    const source = makeSource(['{"q":"x","c":[{"n":9007199254740993},"b"]}'], [0], [2]);
    await loadSource(source, candidates);
    const { container } = render(<App />);

    await waitFor(() => expect(card(container, '0:1').textContent).toContain('b'));
    expect(card(container, '0:0').textContent).toContain('{"n":9007199254740993}');
  });

  it('renders a non-string message content as its JSON (D-015)', async () => {
    const source = makeSource(
      ['{"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]},{"role":"assistant","content":"yo"}]}'],
      [0],
      [1]
    );
    await loadSource(source, MESSAGES);
    const { container } = render(<App />);

    await waitFor(() => expect(card(container, '0').textContent).toContain('yo'));
    expect(card(container, '0').textContent).toContain('[{"type":"text","text":"hi"}]');
  });

  it('shows "kept" on the focused card after A (D-016)', async () => {
    const source = makeSource(
      [
        '{"instruction":"Name a colour","output":"red"}',
        '{"instruction":"Name a colour","output":"blue"}',
      ],
      [0, 0],
      [1, 1]
    );
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '1').textContent).toContain('blue'));

    press('a', 'KeyA');

    await waitFor(() => expect(within(card(container, '0')).getByText('kept')).toBeInTheDocument());
    expect(within(card(container, '1')).queryByText('kept')).toBeNull();
  });

  it('the mapping modal opened from App lists a role that appears only in the second record (D-024)', async () => {
    const format: RecordFormat = {
      kind: 'messages',
      path: 'messages',
      roleKey: 'role',
      contentKey: 'content',
      roles: { user: ['user'], assistant: ['assistant', 'gpt'], system: [] },
    };
    const source = makeSource(
      [
        '{"messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}',
        '{"messages":[{"role":"user","content":"c"},{"role":"gpt","content":"d"}]}',
      ],
      [0, 1],
      [1, 1]
    );
    await loadSource(source, format);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('b'));

    fireEvent.click(screen.getByRole('button', { name: 'Configure format' }));

    await waitFor(() => expect(screen.getByText('Role Mappings')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('gpt', { selector: 'span' })).toBeInTheDocument());
  });

  it('W reveals a trailing space in the rendered view (D-025)', async () => {
    const source = makeSource(['{"instruction":"q","output":"a "}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));

    press('w', 'KeyW');

    await waitFor(() => expect(card(container, '0').textContent).toContain('a·'));
  });

  it('the edited badge toggles the card between its edited value and the diff against the original', async () => {
    const source = makeSource(['{"instruction":"q","output":"red"}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    useReviewStore.getState().edit('0', 'output', 'crimson');
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('crimson'));

    fireEvent.click(within(card(container, '0')).getByRole('button', { name: 'edited' }));

    expect(within(card(container, '0')).getByLabelText('removed: red')).toBeInTheDocument();
    expect(within(card(container, '0')).getByLabelText('added: crimson')).toBeInTheDocument();
    fireEvent.click(within(card(container, '0')).getByRole('button', { name: 'edited' }));
    expect(within(card(container, '0')).queryByLabelText('removed: red')).toBeNull();
  });

  it('shows a null chosen value as null, not as a missing field (D-030)', async () => {
    const preference: RecordFormat = { kind: 'preference', promptPath: 'p', chosenPath: 'chosen', rejectedPath: 'rejected' };
    await loadSource(makeSource(['{"p":"q","chosen":null,"rejected":"b"}'], [0], [2]), preference);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0:1').textContent).toContain('b'));

    expect(within(card(container, '0:0')).getByText('Chosen')).toBeInTheDocument();
    expect(within(card(container, '0:0')).getByText('null')).toBeInTheDocument();
  });

  it('a mapping-modal draft for one file does not carry over to the next (D-044)', async () => {
    await loadSource(makeSource(['{"instruction":"q","output":"a"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));
    fireEvent.click(screen.getByRole('button', { name: 'Configure format' }));
    fireEvent.change(await screen.findByLabelText('Response field'), { target: { value: 'drafted.for.a' } });

    await act(async () => {
      await loadSource(makeSource(['{"instruction":"r","output":"b"}'], [0], [1], { fingerprint: 'fp-b' }), FLAT_IO);
    });
    if (!screen.queryByLabelText('Response field')) {
      fireEvent.click(screen.getByRole('button', { name: 'Configure format' }));
    }

    expect((await screen.findByLabelText('Response field') as HTMLInputElement).value).toBe('output');
  });
});

describe('the record shown is the one at the cursor', () => {
  it('a record that resolves after the cursor moved does not replace the current one (D-065)', async () => {
    const source = makeSource(
      ['{"instruction":"p","output":"first"}', '{"instruction":"q","output":"second"}'],
      [0, 1],
      [1, 1]
    );
    // Line 0 is read slowly: it resolves only when the test releases it
    let releaseFirst: () => void = () => {};
    const readText = source.readText;
    source.readText = (i: number) =>
      i === 0
        ? new Promise<string>((resolve) => {
            releaseFirst = () => resolve('{"instruction":"p","output":"first"}');
          })
        : readText(i);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);

    press('j', 'KeyJ');
    await waitFor(() => expect(card(container, '1').textContent).toContain('second'));
    await act(async () => {
      releaseFirst();
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });

    expect(container.querySelector('[data-candidate-ref]')?.textContent).toContain('second');
  });

  it("neither the editor nor a card shows the previous record under the new ref while its line loads (D-083)", async () => {
    const source = makeSource(
      ['{"instruction":"p","output":"first"}', '{"instruction":"q","output":"second"}'],
      [0, 1],
      [1, 1]
    );
    // Line 1 is read slowly: it resolves only when the test releases it
    const readText = source.readText;
    source.readText = (i: number) => (i === 1 ? new Promise<string>(() => {}) : readText(i));
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('first'));

    press('j', 'KeyJ');
    const cardForLine1 = container.querySelector('[data-candidate-ref="1"]')?.textContent?.includes('first') ?? false;
    press('e', 'KeyE');

    expect({ cardForLine1, editor: screen.queryByLabelText('Edit content') !== null }).toEqual({
      cardForLine1: false,
      editor: false,
    });
  });

  it("neither the editor nor a card shows the previous file's record under the new file's ref while its line loads (D-084)", async () => {
    await loadSource(makeSource(['{"instruction":"p","output":"first"}'], [0], [1], { fingerprint: 'fp-a' }), FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('first'));

    // Another file whose line 0 is read slowly: it never resolves in this test
    const next = makeSource(['{"instruction":"q","output":"other"}'], [0], [1], { fingerprint: 'fp-b' });
    next.readText = () => new Promise<string>(() => {});
    await act(async () => {
      await loadSource(next, FLAT_IO);
    });
    const cardShowsPrevious = container.querySelector('[data-candidate-ref="0"]')?.textContent?.includes('first') ?? false;
    press('e', 'KeyE');

    expect({ cardShowsPrevious, editor: screen.queryByLabelText('Edit content') !== null }).toEqual({
      cardShowsPrevious: false,
      editor: false,
    });
  });
});

describe('an edit opened from the unfocused card', () => {
  it('is saved at the position its own record gives a negative index (D-085)', async () => {
    // The conversation is the last entry of convs; line 0 holds one, line 1 two
    const format: RecordFormat = {
      kind: 'messages',
      path: 'convs[-1]',
      roleKey: 'role',
      contentKey: 'content',
      roles: { user: ['user'], assistant: ['assistant'], system: ['system'] },
    };
    const left = '{"convs":[[{"role":"user","content":"u"},{"role":"assistant","content":"a1"}]]}';
    const right =
      '{"convs":[[{"role":"user","content":"x"},{"role":"assistant","content":"old"}],' +
      '[{"role":"user","content":"u"},{"role":"assistant","content":"b1"}]]}';
    await loadSource(makeSource([left, right], [0, 0], [1, 1]), format);
    useReviewStore.setState({ mode: 'compare', focus: 0 });
    render(<App />);
    await waitFor(() => expect(screen.getByText('b1')).toBeInTheDocument());

    // A click on the right card's turn; focus stays on the left card
    fireEvent.click(screen.getByText('b1').closest('[role="button"]')!);
    const textarea = screen.getByLabelText('Edit content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'B' } });
    press('Enter', 'Enter', { metaKey: true }, textarea);

    const edits = [...useReviewStore.getState().decisions].filter(([, d]) => d.edits).map(([r, d]) => [r, d.edits]);
    expect(edits).toEqual([['1', { 'convs[1][1].content': 'B' }]]);
  });

  it('opens again on the saved edit at a path with a negative index (D-086)', async () => {
    // The conversation is the last entry of convs
    const format: RecordFormat = {
      kind: 'messages',
      path: 'convs[-1]',
      roleKey: 'role',
      contentKey: 'content',
      roles: { user: ['user'], assistant: ['assistant'], system: ['system'] },
    };
    const line =
      '{"convs":[[{"role":"user","content":"x"},{"role":"assistant","content":"old"}],' +
      '[{"role":"user","content":"u"},{"role":"assistant","content":"b1"}]]}';
    await loadSource(makeSource([line], [0], [1]), format);
    render(<App />);
    await waitFor(() => expect(screen.getByText('b1')).toBeInTheDocument());

    // Edit the turn to B, save, and keep it
    fireEvent.click(screen.getByText('b1').closest('[role="button"]')!);
    let textarea = screen.getByLabelText('Edit content') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'B' } });
    press('Enter', 'Enter', { metaKey: true }, textarea);
    await waitFor(() => expect(screen.getByText('Confirm Edit')).toBeInTheDocument());
    press('ArrowRight', 'ArrowRight');

    // Open the same turn again
    await waitFor(() => expect(screen.getByText('B')).toBeInTheDocument());
    fireEvent.click(screen.getByText('B').closest('[role="button"]')!);
    textarea = screen.getByLabelText('Edit content') as HTMLTextAreaElement;

    expect(textarea.value).toBe('B');
  });
});
