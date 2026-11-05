// @vitest-environment node
/**
 * Line diff (PRD §2.5). Expected operations are counted by hand.
 */

import { describe, it, expect } from 'vitest';
import { diffLines, type DiffOp } from '../src/lib/diff';

const count = (ops: DiffOp[], op: DiffOp['op']) => ops.filter((o) => o.op === op).length;

describe('diffLines', () => {
  it('marks one changed line between equal ones', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'delete', text: 'b' },
      { op: 'insert', text: 'x' },
      { op: 'equal', text: 'c' },
    ]);
  });

  it('handles empty and identical texts', () => {
    expect(diffLines('', 'a')).toEqual([{ op: 'insert', text: 'a' }]);
    expect(diffLines('a', '')).toEqual([{ op: 'delete', text: 'a' }]);
    expect(diffLines('a', 'a')).toEqual([{ op: 'equal', text: 'a' }]);
  });

  it('diffs 200,000 lines changed near both ends without an N×M table', () => {
    // Changes at lines 1 and 199,998 leave a 199,998-line middle after trimming
    // (D = 4); a quadratic table of about 4·10^10 cells could not be allocated
    const old = Array.from({ length: 200_000 }, (_, i) => `line ${i}`);
    const neu = [...old];
    neu[1] = 'changed 1';
    neu[199_998] = 'changed 199998';

    const ops = diffLines(old.join('\n'), neu.join('\n'));

    expect(count(ops, 'equal')).toBe(199_998);
    expect(count(ops, 'delete')).toBe(2);
    expect(count(ops, 'insert')).toBe(2);
    expect(ops[1]).toEqual({ op: 'delete', text: 'line 1' });
    expect(ops[2]).toEqual({ op: 'insert', text: 'changed 1' });
  });

  it('falls back to delete-all, insert-all past the edit-distance cap', () => {
    // a1…a1500 against b1…b1500, sharing only "m" at index 750 of both: the
    // LCS is "m" and D = 1,499 + 1,499 = 2,998 > MAX_D, so the optimal diff
    // (which would keep "m" equal) is not searched for
    const old = Array.from({ length: 1500 }, (_, i) => `a${i + 1}`);
    const neu = Array.from({ length: 1500 }, (_, i) => `b${i + 1}`);
    old[750] = 'm';
    neu[750] = 'm';

    const ops = diffLines(old.join('\n'), neu.join('\n'));

    expect(count(ops, 'equal')).toBe(0);
    expect(count(ops, 'delete')).toBe(1500);
    expect(count(ops, 'insert')).toBe(1500);
    expect(ops.slice(0, 1500).every((o) => o.op === 'delete')).toBe(true);
    expect(ops.some((o) => o.op === 'delete' && o.text === 'm')).toBe(true);
    expect(ops.some((o) => o.op === 'insert' && o.text === 'm')).toBe(true);
  });
});
