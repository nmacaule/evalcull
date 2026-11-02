/**
 * CandidateRef helpers for WP 3.
 * Refs follow strict grammar: ^\d+(:\d+)?$
 */

import type { CandidateRef, Decision } from '../types';

/** Strict grammar: ^\d+(:\d+)?$ */
const REF_PATTERN = /^\d+(:\d+)?$/;

/** Validate a CandidateRef against the strict grammar. */
export function isValidRef(ref: string): ref is CandidateRef {
  return REF_PATTERN.test(ref);
}

/** Format a prompt-level ref: just the record index. */
export function formatPromptRef(recordIndex: number): CandidateRef {
  return String(recordIndex);
}

/** Format a candidate ref: `${record}:${candidate}`. */
export function formatCandidateRef(
  recordIndex: number,
  candidateIndex: number
): CandidateRef {
  return `${recordIndex}:${candidateIndex}`;
}

/**
 * Parse the line (record) index from a ref.
 * Assumes ref is valid per isValidRef.
 */
export function parseRefLine(ref: CandidateRef): number {
  const colonIndex = ref.indexOf(':');
  return colonIndex === -1
    ? parseInt(ref, 10)
    : parseInt(ref.slice(0, colonIndex), 10);
}

/** Index of decisions by line, for O(1) lineDecision lookup. */
export interface ByLineIndex {
  promptRefs: Map<number, CandidateRef>;
  candidateRefs: Map<number, CandidateRef[]>; // sorted ascending by candidate index
}

/** Build once per export; WP 4 exporter calls this. */
export function groupByLine(
  decisions: Map<CandidateRef, Decision>
): ByLineIndex {
  const promptRefs = new Map<number, CandidateRef>();
  const candidateRefs = new Map<number, CandidateRef[]>();

  for (const ref of decisions.keys()) {
    const line = parseRefLine(ref);
    if (ref.indexOf(':') === -1) {
      promptRefs.set(line, ref);
    } else {
      const arr = candidateRefs.get(line) ?? [];
      arr.push(ref);
      candidateRefs.set(line, arr);
    }
  }

  // Sort candidate refs by candidate index ascending
  for (const refs of candidateRefs.values()) {
    refs.sort((a, b) => {
      const aIdx = parseInt(a.slice(a.indexOf(':') + 1), 10);
      const bIdx = parseInt(b.slice(b.indexOf(':') + 1), 10);
      return aIdx - bIdx;
    });
  }

  return { promptRefs, candidateRefs };
}

/**
 * Merge decisions for line i using a precomputed index.
 * Returns undefined only if the line has no entries at all (untouched).
 * A touched line always returns a Decision.
 */
export function lineDecision(
  decisions: Map<CandidateRef, Decision>,
  index: ByLineIndex,
  lineIndex: number
): Decision | undefined {
  const promptRef = index.promptRefs.get(lineIndex);
  const candidateRefList = index.candidateRefs.get(lineIndex) ?? [];

  // Untouched line
  if (!promptRef && candidateRefList.length === 0) {
    return undefined;
  }

  // Touched line: start with prompt entry or default
  const promptDecision = promptRef ? decisions.get(promptRef) : undefined;
  let merged: Decision = promptDecision
    ? { ...promptDecision }
    : { status: 'unreviewed', updatedAt: 0 };

  let maxUpdatedAt = merged.updatedAt;

  // Merge candidate edits in ascending order
  for (const ref of candidateRefList) {
    const candidateDecision = decisions.get(ref);
    if (!candidateDecision) continue;

    maxUpdatedAt = Math.max(maxUpdatedAt, candidateDecision.updatedAt);

    if (candidateDecision.edits && Object.keys(candidateDecision.edits).length) {
      merged = {
        ...merged,
        edits: { ...merged.edits, ...candidateDecision.edits },
      };
    }
  }

  merged.updatedAt = maxUpdatedAt;
  return merged;
}
