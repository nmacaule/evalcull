/**
 * Build TRL-shaped preference pairs from decisions.
 *
 * Compare decisions → pairs.jsonl
 * Edits → pairs.edits.jsonl
 */

import type { CandidateRef, Decision, RecordFormat } from '../types';
import { parseRefLine } from '../store/refs';
import { parsePath, getByPath } from './path';

// TRL pair shapes
export interface TrlPairStandard {
  prompt: string;
  chosen: string;
  rejected: string;
}

export interface TrlPairConversational {
  prompt: unknown[];
  chosen: unknown[];
  rejected: unknown[];
}

export interface TrlPairImplicit {
  chosen: string | unknown[];
  rejected: string | unknown[];
}

export type TrlPair = TrlPairStandard | TrlPairConversational | TrlPairImplicit;

export interface PairsResult {
  pairs: TrlPair[];
  editPairs: TrlPair[];
  excludedTies: number;
  excludedBothBad: number;
  implicitPromptCount: number;
  skippedUnparseable: number;
}

/**
 * Normalise message keys and roles to TRL format.
 * Handles ShareGPT (from/value, gpt→assistant) and other variants.
 */
function normaliseMessage(
  msg: Record<string, unknown>,
  format: Extract<RecordFormat, { kind: 'messages' }>
): { role: string; content: string } {
  const roleKey = format.roleKey;
  const contentKey = format.contentKey;

  let role = String(msg[roleKey] ?? '');
  const content = String(msg[contentKey] ?? '');

  // Normalise roles
  if (format.roles.assistant.includes(role)) {
    role = 'assistant';
  } else if (format.roles.user.includes(role)) {
    role = 'user';
  } else if (format.roles.system.includes(role)) {
    role = 'system';
  }

  return { role, content };
}

/**
 * Get value at a path string using the shared path parser.
 */
function getPath(obj: unknown, path: string): unknown {
  try {
    const segments = parsePath(path);
    return getByPath(obj, segments);
  } catch {
    return undefined;
  }
}

/**
 * Build preference pairs from compare decisions and edits.
 *
 * @param decisions Map of decisions keyed by CandidateRef
 * @param format Record format for interpreting records
 * @param getRecord Sync function to get parsed record (caller pre-fetches)
 * @param isUnparseable Optional function to check if a line is unparseable
 */
export function buildPairs(
  decisions: Map<CandidateRef, Decision>,
  format: RecordFormat,
  getRecord: (i: number) => unknown,
  isUnparseable?: (i: number) => boolean
): PairsResult {
  const pairs: TrlPair[] = [];
  const editPairs: TrlPair[] = [];
  let excludedTies = 0;
  let excludedBothBad = 0;
  let implicitPromptCount = 0;
  let skippedUnparseable = 0;

  // Collect prompt entries with compare decisions, sorted by line index
  const compareRefs: Array<{ ref: CandidateRef; lineIdx: number; decision: Decision }> = [];

  for (const [ref, decision] of decisions) {
    if (decision.compare?.length) {
      compareRefs.push({ ref, lineIdx: parseRefLine(ref), decision });
    }
  }

  // Sort by line index for ascending order output
  compareRefs.sort((a, b) => a.lineIdx - b.lineIdx);

  /** A parsed record for line i, or undefined when unparseable or missing. */
  const recordAt = (i: number): unknown =>
    isUnparseable && isUnparseable(i) ? undefined : getRecord(i);

  // One row per judged pair, in judgement order within a prompt (v3.3)
  for (const { lineIdx, decision } of compareRefs) {
    for (const compare of decision.compare!) {
      // Skip ties and both_bad
      if (compare.preference === 'tie') {
        excludedTies++;
        continue;
      }
      if (compare.preference === 'both_bad') {
        excludedBothBad++;
        continue;
      }

      // The prompt comes from the prompt entry's line; each candidate from its own ref
      const promptRecord = recordAt(lineIdx);
      const chosenRef = compare.preference === 'left' ? compare.left : compare.right;
      const rejectedRef = compare.preference === 'left' ? compare.right : compare.left;
      const chosenRecord = recordAt(parseRefLine(chosenRef));
      const rejectedRecord = recordAt(parseRefLine(rejectedRef));
      if (
        promptRecord === undefined ||
        chosenRecord === undefined ||
        rejectedRecord === undefined
      ) {
        skippedUnparseable++;
        continue;
      }

      const pair = buildPairFromCompare(
        promptRecord,
        { ref: chosenRef, record: chosenRecord },
        { ref: rejectedRef, record: rejectedRecord },
        format
      );
      if (pair) {
        if ('prompt' in pair === false) {
          implicitPromptCount++;
        }
        pairs.push(pair);
      }
    }
  }

  // Process edits for edit pairs
  const editRefs: Array<{ ref: CandidateRef; lineIdx: number; decision: Decision }> = [];

  for (const [ref, decision] of decisions) {
    if (decision.edits && Object.keys(decision.edits).length > 0) {
      editRefs.push({ ref, lineIdx: parseRefLine(ref), decision });
    }
  }

  editRefs.sort((a, b) => a.lineIdx - b.lineIdx);

  for (const { lineIdx, decision } of editRefs) {
    if (isUnparseable && isUnparseable(lineIdx)) {
      skippedUnparseable++;
      continue;
    }

    const record = getRecord(lineIdx);
    if (record === undefined) {
      skippedUnparseable++;
      continue;
    }

    const editPair = buildEditPair(record, decision.edits!, format);
    if (editPair) {
      editPairs.push(editPair);
    }
  }

  return {
    pairs,
    editPairs,
    excludedTies,
    excludedBothBad,
    implicitPromptCount,
    skippedUnparseable,
  };
}

/** Index of the last assistant turn of a messages array, or −1. */
function lastAssistantIndex(
  messages: unknown[],
  format: Extract<RecordFormat, { kind: 'messages' }>
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    const role = String(msg[format.roleKey] ?? '');
    if (format.roles.assistant.includes(role)) return i;
  }
  return -1;
}

/** Candidate index k of an in-record ref "i:k", or −1 for a line ref. */
function candidateIndex(ref: CandidateRef): number {
  const colon = ref.indexOf(':');
  return colon === -1 ? -1 : parseInt(ref.slice(colon + 1), 10);
}

/**
 * The text a candidate ref names, read from that candidate's own record:
 * a line ref's response (flat) or last assistant turn (messages); an "i:k"
 * ref's candidatesPath[k], or chosen (k 0) / rejected (k 1) for preference.
 */
function candidateValue(
  ref: CandidateRef,
  record: unknown,
  format: RecordFormat
): { ok: true; value: unknown } | { ok: false } {
  switch (format.kind) {
    case 'flat': {
      const value = getPath(record, format.responsePath);
      return typeof value === 'string' ? { ok: true, value } : { ok: false };
    }
    case 'messages': {
      const messages = getPath(record, format.path);
      if (!Array.isArray(messages)) return { ok: false };
      const idx = lastAssistantIndex(messages, format);
      if (idx < 0) return { ok: false };
      return {
        ok: true,
        value: [normaliseMessage(messages[idx] as Record<string, unknown>, format)],
      };
    }
    case 'candidates': {
      const candidates = getPath(record, format.candidatesPath);
      const k = candidateIndex(ref);
      if (!Array.isArray(candidates) || k < 0 || k >= candidates.length) return { ok: false };
      return { ok: true, value: candidates[k] };
    }
    case 'preference': {
      const k = candidateIndex(ref);
      if (k === 0) return { ok: true, value: getPath(record, format.chosenPath) };
      if (k === 1) return { ok: true, value: getPath(record, format.rejectedPath) };
      return { ok: false };
    }
    default:
      return { ok: false };
  }
}

/**
 * Build a TRL pair from one compare element (v3.3). The prompt comes from the
 * prompt entry's record; chosen and rejected from each candidate's own record.
 */
function buildPairFromCompare(
  promptRecord: unknown,
  chosen: { ref: CandidateRef; record: unknown },
  rejected: { ref: CandidateRef; record: unknown },
  format: RecordFormat
): TrlPair | null {
  const chosenVal = candidateValue(chosen.ref, chosen.record, format);
  const rejectedVal = candidateValue(rejected.ref, rejected.record, format);
  if (!chosenVal.ok || !rejectedVal.ok) return null;

  switch (format.kind) {
    case 'messages': {
      // Prompt is every turn before the prompt line's last assistant turn
      const messages = getPath(promptRecord, format.path);
      if (!Array.isArray(messages)) return null;
      const idx = lastAssistantIndex(messages, format);
      if (idx < 0) return null;
      const prompt = messages
        .slice(0, idx)
        .map((m) => normaliseMessage(m as Record<string, unknown>, format));
      return {
        prompt,
        chosen: chosenVal.value as unknown[],
        rejected: rejectedVal.value as unknown[],
      } as TrlPairConversational;
    }

    case 'flat':
    case 'candidates': {
      const promptVal = getPath(promptRecord, format.promptPath);
      if (typeof promptVal !== 'string') return null;
      return {
        prompt: promptVal,
        chosen: chosenVal.value,
        rejected: rejectedVal.value,
      } as TrlPairStandard;
    }

    case 'preference': {
      if (format.promptPath) {
        const promptVal = getPath(promptRecord, format.promptPath);
        if (typeof promptVal === 'string') {
          return {
            prompt: promptVal,
            chosen: chosenVal.value,
            rejected: rejectedVal.value,
          } as TrlPairStandard;
        }
      }

      // Implicit prompt (no promptPath)
      return {
        chosen: chosenVal.value,
        rejected: rejectedVal.value,
      } as TrlPairImplicit;
    }

    default:
      return null;
  }
}

/**
 * Check if edit path segments match format.path as prefix, then [index].contentKey.
 * Returns the turn index if match, or -1 if no match.
 */
function matchEditPath(
  editSegments: ReturnType<typeof parsePath>,
  formatPathSegments: ReturnType<typeof parsePath>,
  contentKey: string
): number {
  const n = formatPathSegments.length;

  // Edit path should be: format.path segments + [index] + contentKey
  // Total length: n + 2
  if (editSegments.length !== n + 2) return -1;

  // Match format.path prefix
  for (let i = 0; i < n; i++) {
    const edit = editSegments[i];
    const fmt = formatPathSegments[i];
    if (edit.type !== fmt.type) return -1;
    if (edit.type === 'member' && fmt.type === 'member' && edit.key !== fmt.key) return -1;
    if (edit.type === 'index' && fmt.type === 'index' && edit.index !== fmt.index) return -1;
  }

  // Position n should be an index segment
  const indexSeg = editSegments[n];
  if (indexSeg.type !== 'index') return -1;

  // Position n+1 should be the contentKey member
  const contentSeg = editSegments[n + 1];
  if (contentSeg.type !== 'member' || contentSeg.key !== contentKey) return -1;

  return indexSeg.index;
}

/**
 * Build an edit pair: edited version as chosen, original as rejected.
 */
function buildEditPair(
  record: unknown,
  edits: Record<string, unknown>,
  format: RecordFormat
): TrlPair | null {
  if (format.kind === 'messages') {
    // Find which turn was edited
    const messages = getPath(record, format.path) as unknown[] | undefined;
    if (!Array.isArray(messages)) return null;

    // Parse format.path once
    let formatPathSegments;
    try {
      formatPathSegments = parsePath(format.path);
    } catch {
      return null;
    }

    // Find the edit path that references a message
    // e.g., "messages[3].content" or "data.messages[3].content"
    for (const [path, newValue] of Object.entries(edits)) {
      let segments;
      try {
        segments = parsePath(path);
      } catch {
        continue;
      }

      // Match edit path against format.path prefix + [index] + contentKey
      const turnIdx = matchEditPath(segments, formatPathSegments, format.contentKey);
      if (turnIdx < 0 || turnIdx >= messages.length) continue;

      const originalMsg = messages[turnIdx] as Record<string, unknown>;
      const originalContent = originalMsg[format.contentKey];

      // Normalise messages
      const normalisedMessages = messages.map((m) =>
        normaliseMessage(m as Record<string, unknown>, format)
      );

      // prompt = turns 0..k-1
      const prompt = normalisedMessages.slice(0, turnIdx);

      // chosen = edited turn
      const chosen = [{ role: 'assistant', content: newValue }];

      // rejected = original turn
      const rejected = [{ role: 'assistant', content: originalContent }];

      return { prompt, chosen, rejected } as TrlPairConversational;
    }
  } else if (format.kind === 'flat') {
    // For flat, edit of responsePath
    const promptVal = getPath(record, format.promptPath);
    const originalResponse = getPath(record, format.responsePath);

    const editedResponse = edits[format.responsePath];
    if (editedResponse === undefined) return null;

    if (typeof promptVal === 'string') {
      return {
        prompt: promptVal,
        chosen: editedResponse as string,
        rejected: originalResponse as string,
      } as TrlPairStandard;
    }
  }

  return null;
}
