// @vitest-environment node
/**
 * Count phrases (owner Q3, 4 Nov 2026), written by hand for 1 and 2.
 */

import { describe, it, expect } from 'vitest';
import { countPhrase } from '../src/lib/plural';

describe('countPhrase', () => {
  it.each([
    ['pair', 'pairs', '1 pair', '2 pairs'],
    ['tie', 'ties', '1 tie', '2 ties'],
    ['both-unacceptable pair', 'both-unacceptable pairs', '1 both-unacceptable pair', '2 both-unacceptable pairs'],
    ['unparseable line', 'unparseable lines', '1 unparseable line', '2 unparseable lines'],
    [
      'row has no prompt field and uses',
      'rows have no prompt field and use',
      '1 row has no prompt field and uses',
      '2 rows have no prompt field and use',
    ],
  ])('%s / %s', (one, many, expectOne, expectTwo) => {
    expect(countPhrase(1, one, many)).toBe(expectOne);
    expect(countPhrase(2, one, many)).toBe(expectTwo);
  });

  it('uses the plural for 0 and groups thousands', () => {
    expect(countPhrase(0, 'pair', 'pairs')).toBe('0 pairs');
    expect(countPhrase(2000, 'pair', 'pairs')).toBe('2,000 pairs');
  });
});
