/**
 * Candidate model and knockout derivation (WP 6c, PRD v3.3 §2.2, §2.3).
 *
 * A prompt is a group of lines. Its compare[] lives on the ref of the group's
 * first line. Its candidates are the group's lines' own refs for row formats
 * (flat, messages, unknown) and `i:k` refs for in-record formats (candidates,
 * preference), using FileIndex.candidates for each line's count.
 *
 * A prompt with N candidates is judged as a knockout in N−1 pairs: candidate 0
 * meets candidate 1, the preferred one stays and meets the next. On a tie or
 * both_bad the incumbent stays; in round 1 that is candidate 0. From round 2
 * the incumbent is on the right in even rounds and on the left in odd rounds.
 */

import type { CandidateRef, CompareDecision, Preference, RecordFormat } from '../types';

/** Lines of each group in ascending order: lines[offsets[g]] … lines[offsets[g+1] − 1]. */
export interface GroupLines {
  offsets: Uint32Array;
  lines: Uint32Array;
}

/** One O(lines) pass: counting sort of line indices by group. */
export function buildGroupLines(groups: Uint32Array, groupCount: number): GroupLines {
  const offsets = new Uint32Array(groupCount + 1);
  for (let i = 0; i < groups.length; i++) offsets[groups[i] + 1]++;
  for (let g = 0; g < groupCount; g++) offsets[g + 1] += offsets[g];

  const lines = new Uint32Array(groups.length);
  const next = offsets.slice(0, groupCount);
  for (let i = 0; i < groups.length; i++) lines[next[groups[i]]++] = i;

  return { offsets, lines };
}

/** True for the formats whose candidates live inside one record. */
export function isInRecordFormat(format: RecordFormat): boolean {
  return format.kind === 'candidates' || format.kind === 'preference';
}

export interface PromptCandidates {
  /** String(first line of the group); the entry that holds compare[]. */
  promptRef: CandidateRef;
  /** Ordered: candidate 0 … N−1; N = candidates.length. */
  candidates: CandidateRef[];
}

/** The candidate model: the prompt entry and the ordered candidate refs of group g. */
export function promptCandidates(
  table: GroupLines,
  candidatesPerLine: Uint16Array,
  format: RecordFormat,
  g: number,
): PromptCandidates {
  const start = table.offsets[g];
  const end = table.offsets[g + 1];
  const promptRef = String(table.lines[start]);
  const candidates: CandidateRef[] = [];

  if (isInRecordFormat(format)) {
    for (let j = start; j < end; j++) {
      const line = table.lines[j];
      const count = candidatesPerLine[line];
      for (let k = 0; k < count; k++) candidates.push(`${line}:${k}`);
    }
  } else {
    for (let j = start; j < end; j++) candidates.push(String(table.lines[j]));
  }

  return { promptRef, candidates };
}

export interface KnockoutState {
  /** N−1; 0 when N < 2. */
  totalPairs: number;
  /** k = min(compare.length, N−1). */
  judged: number;
  /** N ≥ 2 && k === N−1. */
  complete: boolean;
  /** The pair shown: pair k when incomplete; the last judged pair when complete; null when N < 2. */
  shown: { pair: number; left: CandidateRef; right: CandidateRef; judged?: Preference } | null;
  /** The incumbent of the pair shown; null in round 1 and when N < 2. */
  incumbent: { ref: CandidateRef; side: 'left' | 'right' } | null;
}

/** The candidate that stays after a judged pair, given the incumbent going into it. */
function winnerOf(pair: CompareDecision, incumbent: CandidateRef): CandidateRef {
  if (pair.preference === 'left') return pair.left;
  if (pair.preference === 'right') return pair.right;
  return incumbent; // tie or both_bad: the incumbent stays
}

/** Derive the knockout state of a prompt from its candidates and its compare decisions. */
export function deriveKnockout(
  candidates: readonly CandidateRef[],
  compare: readonly CompareDecision[] | undefined,
): KnockoutState {
  const n = candidates.length;
  if (n < 2) {
    return { totalPairs: 0, judged: 0, complete: false, shown: null, incumbent: null };
  }

  const totalPairs = n - 1;
  const judged = Math.min(compare?.length ?? 0, totalPairs);
  const complete = judged === totalPairs;
  const pair = complete ? totalPairs - 1 : judged;

  // Incumbent going into each pair j ≥ 1 is the winner after pair j−1.
  // Going into pair 0 there is no incumbent; candidate 0 stays on a tie.
  let incumbentRef: CandidateRef = candidates[0];
  for (let j = 0; j < pair; j++) incumbentRef = winnerOf(compare![j], incumbentRef);

  if (complete) {
    const last = compare![pair];
    return {
      totalPairs,
      judged,
      complete,
      shown: { pair, left: last.left, right: last.right, judged: last.preference },
      incumbent: pair === 0 ? null : { ref: incumbentRef, side: sideOf(pair) },
    };
  }

  if (pair === 0) {
    return {
      totalPairs,
      judged,
      complete,
      shown: { pair: 0, left: candidates[0], right: candidates[1] },
      incumbent: null,
    };
  }

  const side = sideOf(pair);
  const challenger = candidates[pair + 1];
  return {
    totalPairs,
    judged,
    complete,
    shown:
      side === 'right'
        ? { pair, left: challenger, right: incumbentRef }
        : { pair, left: incumbentRef, right: challenger },
    incumbent: { ref: incumbentRef, side },
  };
}

/** Pair j is round j+1; the incumbent is on the right in even rounds, the left in odd rounds. */
function sideOf(pair: number): 'left' | 'right' {
  return (pair + 1) % 2 === 0 ? 'right' : 'left';
}
