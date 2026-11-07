/**
 * Whitespace reveal (W): one marker per space, tab and line end (D-026). From
 * WP 7b the marks are their own parts, so each can take the neutral-11 mark
 * colour (PRD §2.11 screen 5, DR-022); the existing cases read the parts joined,
 * with their expected strings unchanged (owner, 6 Nov 2026).
 */

import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { RawView } from '../src/components/RawView';
import { whitespaceParts } from '../src/lib/whitespace';
import App from '../src/App';
import { makeSource, loadSource, card, press, resetStore, MESSAGES } from './helpers/app';

const joined = (text: string) => whitespaceParts(text).map((p) => p.text).join('');

describe('whitespace reveal', () => {
  it('marks a CRLF line end once (D-026)', () => {
    const { container } = render(<RawView text={'a\r\nb'} showWhitespace={true} />);
    expect(container.querySelector('pre')!.textContent).toBe('a↵\r\nb');
  });

  it('marks each space, tab and line end once', () => {
    expect(joined('a\r\nb')).toBe('a↵\r\nb');
    expect(joined('a\nb')).toBe('a↵\nb');
    expect(joined('a b\tc')).toBe('a·b→\tc');
  });

  it('whitespaceParts marks a CRLF once, as one mark part', () => {
    expect(whitespaceParts('a\r\nb c')).toEqual([
      { text: 'a', mark: false },
      { text: '↵\r\n', mark: true },
      { text: 'b', mark: false },
      { text: '·', mark: true },
      { text: 'c', mark: false },
    ]);
  });

  it('W marks a trailing space in a conversation turn with a mark span', async () => {
    resetStore();
    const source = makeSource(
      [
        '{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"hi "}]}',
        '{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"b"}]}',
      ],
      [0, 0],
      [1, 1]
    );
    await loadSource(source, MESSAGES);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '1').textContent).toContain('b'));

    press('w', 'KeyW');

    const marks = Array.from(card(container, '0').querySelectorAll('[data-ws-mark]')).map((m) => m.textContent);
    expect(marks).toEqual(['·']);
  });
});
