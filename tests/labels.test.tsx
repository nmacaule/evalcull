/**
 * Plain-language labels (WP 7d, DR-032 and its amendments of 7 Nov 2026). Oracle: the
 * owner-approved strings, written by hand.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import 'fake-indexeddb/auto';
import App from '../src/App';
import { SchemaMapper } from '../src/components/SchemaMapper';
import { makeSource, press, loadSource, card, resetStore, FLAT_IO } from './helpers/app';
import type { RecordFormat } from '../src/types';

const CANDIDATES: RecordFormat = { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'responses' };
const FOUR = ['{"prompt":"p","responses":["w","x","y","z"]}', '{"prompt":"q","responses":["a","b"]}'];
const FLAT_TWO = ['{"instruction":"q one","output":"a one"}', '{"instruction":"q two","output":"a two"}'];

async function compareApp() {
  await loadSource(makeSource(FOUR, [0, 1], [4, 2]), CANDIDATES);
  const view = render(<App />);
  await waitFor(() => expect(card(view.container, '0:1').textContent).toContain('x'));
  return view;
}

async function singleApp() {
  await loadSource(makeSource(FLAT_TWO, [0, 1], [1, 1]), FLAT_IO);
  const view = render(<App />);
  await waitFor(() => expect(card(view.container, '0').textContent).toContain('a one'));
  return view;
}

beforeEach(() => {
  resetStore();
  localStorage.clear();
});

describe('card titles (DR-032)', () => {
  it('compare cards are titled Response k by their place in the prompt, not by ref', async () => {
    const { container } = await compareApp();
    expect(within(card(container, '0:0')).getByText('Response 1')).toBeInTheDocument();
    expect(within(card(container, '0:1')).getByText('Response 2')).toBeInTheDocument();
    expect(within(card(container, '0:0')).queryByText('0:0')).toBeNull();

    // Round 2: candidate 2 left, the incumbent 0:0 right with its badge
    press('ArrowLeft', 'ArrowLeft');
    await waitFor(() => expect(card(container, '0:2').textContent).toContain('y'));
    expect(within(card(container, '0:2')).getByText('Response 3')).toBeInTheDocument();
    expect(within(card(container, '0:0')).getByText('Response 1')).toBeInTheDocument();
    expect(within(card(container, '0:0')).getByText('Winner so far')).toBeInTheDocument();
    expect(screen.getByText('Comparison 2 of 3 · 4 responses')).toBeInTheDocument();
  });

  it('the single card is titled Record n, counted from 1 like the footer', async () => {
    const { container } = await singleApp();
    expect(within(card(container, '0')).getByText('Record 1')).toBeInTheDocument();
    expect(screen.getByText('Record 1 of 2')).toBeInTheDocument();
  });

  it('the metadata panel shows the ref the title replaced', async () => {
    await compareApp();
    press('m', 'KeyM');
    const panel = await screen.findByRole('region', { name: 'Metadata' });
    expect(within(panel).getByText('Ref 0:0')).toBeInTheDocument();
  });
});

describe('editor and notes subjects (DR-032)', () => {
  it('the editor names the response and its prompt, and the field', async () => {
    await compareApp();
    press('e', 'KeyE');
    expect(await screen.findByText('Editing response 1 of prompt 1')).toBeInTheDocument();
    expect(screen.getByText(/^Field:/)).toBeInTheDocument();
    expect(screen.queryByText(/^Path:/)).toBeNull();
  });

  it('the editor names the record in single mode', async () => {
    await singleApp();
    press('e', 'KeyE');
    expect(await screen.findByText('Editing record 1')).toBeInTheDocument();
  });

  it('the labels and notes dialog names the response and its prompt', async () => {
    await compareApp();
    press('l', 'KeyL');
    expect(await screen.findByText(/^For response 1 of prompt 1\./)).toBeInTheDocument();
  });

  it('the labels and notes dialog names the record in single mode', async () => {
    await singleApp();
    press('n', 'KeyN');
    expect(await screen.findByText(/^For record 1\./)).toBeInTheDocument();
  });
});

describe('the mapping modal (DR-032 and its amendment)', () => {
  function mapper(format: RecordFormat, sample: unknown) {
    render(
      <SchemaMapper open={true} onOpenChange={() => {}} currentFormat={format} sampleRecords={[sample]} onApply={() => {}} />
    );
  }

  it('says what it is for, and names each record type with what it expects', () => {
    mapper({ kind: 'flat', promptPath: 'prompt', responsePath: 'response' }, { prompt: 'P', response: 'R' });
    expect(screen.getByText('Tell evalcull which fields hold the prompt and the responses.')).toBeInTheDocument();
    const options = Array.from((screen.getByLabelText('Record type') as HTMLSelectElement).options).map((o) => [o.value, o.text]);
    expect(options).toEqual([
      ['flat', 'Prompt-completion (a prompt and a response field)'],
      ['messages', 'Conversational (one list of turns)'],
      ['preference', 'Preference (chosen, rejected; prompt optional)'],
      ['candidates', 'Candidates (a prompt and a list of responses)'],
      ['unknown', 'Other (raw view, no grouping)'],
    ]);
  });

  it.each([
    [{ kind: 'flat', promptPath: 'prompt', responsePath: 'response' }, { 'Prompt field': 'e.g. prompt or instruction', 'Response field': 'e.g. response or output' }],
    [{ kind: 'messages', path: 'messages', roleKey: 'role', contentKey: 'content', roles: { user: ['user'], assistant: ['assistant'], system: ['system'] } }, { 'Messages field': 'e.g. messages or conversations' }],
    [{ kind: 'preference', promptPath: 'prompt', chosenPath: 'chosen', rejectedPath: 'rejected' }, { 'Chosen field': 'e.g. chosen', 'Rejected field': 'e.g. rejected' }],
    [CANDIDATES, { 'Responses field': 'e.g. responses or candidates' }],
  ] as [RecordFormat, Record<string, string>][])('names real field names as examples (%#)', (format, placeholders) => {
    mapper(format, {});
    for (const [label, example] of Object.entries(placeholders)) {
      expect(screen.getByLabelText(label)).toHaveAttribute('placeholder', example);
    }
  });

  it('previews the responses field as N responses', () => {
    mapper(CANDIDATES, { prompt: 'p', responses: ['w', 'x', 'y', 'z'] });
    expect(screen.getByText('Preview: 4 responses')).toBeInTheDocument();
  });

  it('previews any other array as N items', () => {
    mapper({ kind: 'flat', promptPath: 'prompt', responsePath: 'response' }, { prompt: ['a', 'b'], response: 'R' });
    expect(screen.getByText('Preview: 2 items')).toBeInTheDocument();
  });
});
