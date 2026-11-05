/**
 * Whitespace reveal (W): one marker per space, tab and line end (D-026).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RawView } from '../src/components/RawView';
import { revealWhitespace } from '../src/lib/whitespace';

describe('whitespace reveal', () => {
  it('marks a CRLF line end once (D-026)', () => {
    const { container } = render(<RawView text={'a\r\nb'} showWhitespace={true} />);
    expect(container.querySelector('pre')!.textContent).toBe('a↵\r\nb');
  });

  it('marks each space, tab and line end once', () => {
    expect(revealWhitespace('a\r\nb')).toBe('a\u21B5\r\nb');
    expect(revealWhitespace('a\nb')).toBe('a\u21B5\nb');
    expect(revealWhitespace('a b\tc')).toBe('a\u00B7b\u2192\tc');
  });
});
