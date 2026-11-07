/**
 * Class merging with the §2.11 token names (WP 7b): the merger must keep a
 * token font size beside a colour, and still let a later radius win.
 */

import { describe, it, expect } from 'vitest';
import { cn } from '../src/lib/utils';

describe('cn with the §2.11 tokens', () => {
  it('keeps text-chrome beside text-neutral-12', () => {
    expect(cn('text-chrome', 'text-neutral-12')).toBe('text-chrome text-neutral-12');
  });

  it('keeps text-heading beside text-neutral-11', () => {
    expect(cn('text-heading', 'text-neutral-11')).toBe('text-heading text-neutral-11');
  });

  it('lets the later of two token radii win', () => {
    expect(cn('rounded-control', 'rounded-panel')).toBe('rounded-panel');
  });
});
