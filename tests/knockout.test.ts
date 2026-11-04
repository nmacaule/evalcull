/**
 * WP 6c: knockout derivation and the candidate model.
 *
 * Oracle: hand-written tables from PRD v3.3 §2.2 ("More than two candidates")
 * and the WP 6c plan's decisions a–c, j and Q1. Nothing is recomputed here.
 */

import { describe, it, expect } from 'vitest';
import {
  buildGroupLines,
  deriveKnockout,
  promptCandidates,
  type KnockoutState,
} from '../src/lib/knockout';
import type { CompareDecision, Preference, RecordFormat } from '../src/types';

const c0 = '0:0';
const c1 = '0:1';
const c2 = '0:2';
const c3 = '0:3';
const ALL = [c0, c1, c2, c3];

function pair(left: string, right: string, preference: Preference): CompareDecision {
  return { left, right, preference };
}

interface Row {
  name: string;
  n: number;
  compare: CompareDecision[] | undefined;
  expected: KnockoutState;
}

const NONE: KnockoutState = {
  totalPairs: 0,
  judged: 0,
  complete: false,
  shown: null,
  incumbent: null,
};

const ROWS: Row[] = [
  { name: 'N=0', n: 0, compare: undefined, expected: NONE },
  { name: 'N=1', n: 1, compare: undefined, expected: NONE },
  {
    name: 'N=2, nothing judged: round 1, no badge',
    n: 2,
    compare: [],
    expected: {
      totalPairs: 1,
      judged: 0,
      complete: false,
      shown: { pair: 0, left: c0, right: c1 },
      incumbent: null,
    },
  },
  {
    name: 'N=2, one pair: complete, last pair shown with its judgement',
    n: 2,
    compare: [pair(c0, c1, 'left')],
    expected: {
      totalPairs: 1,
      judged: 1,
      complete: true,
      shown: { pair: 0, left: c0, right: c1, judged: 'left' },
      incumbent: null,
    },
  },
  {
    name: 'N=3, nothing judged',
    n: 3,
    compare: undefined,
    expected: {
      totalPairs: 2,
      judged: 0,
      complete: false,
      shown: { pair: 0, left: c0, right: c1 },
      incumbent: null,
    },
  },
  {
    name: 'N=3, right wins round 1: round 2 puts the incumbent on the right',
    n: 3,
    compare: [pair(c0, c1, 'right')],
    expected: {
      totalPairs: 2,
      judged: 1,
      complete: false,
      shown: { pair: 1, left: c2, right: c1 },
      incumbent: { ref: c1, side: 'right' },
    },
  },
  {
    name: 'N=3, both pairs judged: complete',
    n: 3,
    compare: [pair(c0, c1, 'right'), pair(c2, c1, 'left')],
    expected: {
      totalPairs: 2,
      judged: 2,
      complete: true,
      shown: { pair: 1, left: c2, right: c1, judged: 'left' },
      incumbent: { ref: c1, side: 'right' },
    },
  },
  {
    name: 'N=3, round-1 tie: candidate 0 stays and meets candidate 2 (Q1)',
    n: 3,
    compare: [pair(c0, c1, 'tie')],
    expected: {
      totalPairs: 2,
      judged: 1,
      complete: false,
      shown: { pair: 1, left: c2, right: c0 },
      incumbent: { ref: c0, side: 'right' },
    },
  },
  {
    name: 'N=3, round-1 both_bad: candidate 0 stays (Q1)',
    n: 3,
    compare: [pair(c0, c1, 'both_bad')],
    expected: {
      totalPairs: 2,
      judged: 1,
      complete: false,
      shown: { pair: 1, left: c2, right: c0 },
      incumbent: { ref: c0, side: 'right' },
    },
  },
  {
    name: 'N=4, nothing judged',
    n: 4,
    compare: [],
    expected: {
      totalPairs: 3,
      judged: 0,
      complete: false,
      shown: { pair: 0, left: c0, right: c1 },
      incumbent: null,
    },
  },
  {
    name: 'N=4, left wins round 1',
    n: 4,
    compare: [pair(c0, c1, 'left')],
    expected: {
      totalPairs: 3,
      judged: 1,
      complete: false,
      shown: { pair: 1, left: c2, right: c0 },
      incumbent: { ref: c0, side: 'right' },
    },
  },
  {
    name: 'N=4, tie in round 2: the incumbent stays and moves to the left in round 3',
    n: 4,
    compare: [pair(c0, c1, 'left'), pair(c2, c0, 'tie')],
    expected: {
      totalPairs: 3,
      judged: 2,
      complete: false,
      shown: { pair: 2, left: c0, right: c3 },
      incumbent: { ref: c0, side: 'left' },
    },
  },
  {
    name: 'N=4, both_bad in round 2: the incumbent stays',
    n: 4,
    compare: [pair(c0, c1, 'right'), pair(c2, c1, 'both_bad')],
    expected: {
      totalPairs: 3,
      judged: 2,
      complete: false,
      shown: { pair: 2, left: c1, right: c3 },
      incumbent: { ref: c1, side: 'left' },
    },
  },
  {
    name: 'N=4, challenger wins round 2 and becomes the incumbent on the left',
    n: 4,
    compare: [pair(c0, c1, 'left'), pair(c2, c0, 'left')],
    expected: {
      totalPairs: 3,
      judged: 2,
      complete: false,
      shown: { pair: 2, left: c2, right: c3 },
      incumbent: { ref: c2, side: 'left' },
    },
  },
  {
    name: 'N=4, all three pairs judged: complete',
    n: 4,
    compare: [pair(c0, c1, 'left'), pair(c2, c0, 'tie'), pair(c0, c3, 'right')],
    expected: {
      totalPairs: 3,
      judged: 3,
      complete: true,
      shown: { pair: 2, left: c0, right: c3, judged: 'right' },
      incumbent: { ref: c0, side: 'left' },
    },
  },
];

describe('deriveKnockout (WP 6c)', () => {
  it.each(ROWS)('$name', ({ n, compare, expected }) => {
    expect(deriveKnockout(ALL.slice(0, n), compare)).toEqual(expected);
  });
});

const FLAT: RecordFormat = { kind: 'flat', promptPath: 'prompt', responsePath: 'response' };
const CANDIDATES: RecordFormat = {
  kind: 'candidates',
  promptPath: 'prompt',
  candidatesPath: 'candidates',
};
const PREFERENCE: RecordFormat = {
  kind: 'preference',
  promptPath: 'prompt',
  chosenPath: 'chosen',
  rejectedPath: 'rejected',
};

function candidatesOf(
  groups: number[],
  groupCount: number,
  counts: number[],
  format: RecordFormat,
  g: number
) {
  const table = buildGroupLines(Uint32Array.from(groups), groupCount);
  return promptCandidates(table, Uint16Array.from(counts), format, g);
}

describe('promptCandidates (WP 6c)', () => {
  it('row format: the group lines are the candidates, compare[] on the first line', () => {
    const groups = [0, 1, 0, 2, 1, 0];
    const counts = [1, 1, 1, 1, 1, 1];
    expect(candidatesOf(groups, 3, counts, FLAT, 0)).toEqual({
      promptRef: '0',
      candidates: ['0', '2', '5'],
    });
    expect(candidatesOf(groups, 3, counts, FLAT, 1)).toEqual({
      promptRef: '1',
      candidates: ['1', '4'],
    });
    expect(candidatesOf(groups, 3, counts, FLAT, 2)).toEqual({
      promptRef: '3',
      candidates: ['3'],
    });
  });

  it('in-record format: i:k over the group lines and each line count', () => {
    expect(candidatesOf([0, 1, 0], 2, [3, 2, 1], CANDIDATES, 0)).toEqual({
      promptRef: '0',
      candidates: ['0:0', '0:1', '0:2', '2:0'],
    });
  });

  it('preference: k 0 and k 1 of the line', () => {
    expect(candidatesOf([0], 1, [2], PREFERENCE, 0)).toEqual({
      promptRef: '0',
      candidates: ['0:0', '0:1'],
    });
  });

  it('row format: an unparseable line (count 0, its own group) is a one-candidate prompt', () => {
    expect(candidatesOf([0, 1, 0, 2, 1, 0], 3, [1, 1, 1, 0, 1, 1], FLAT, 2)).toEqual({
      promptRef: '3',
      candidates: ['3'],
    });
  });

  it('in-record format: a line with no array has no candidates', () => {
    expect(candidatesOf([0], 1, [0], CANDIDATES, 0)).toEqual({
      promptRef: '0',
      candidates: [],
    });
  });
});
