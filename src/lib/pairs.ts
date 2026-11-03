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

  // Collect refs with compare decisions, sorted by line index
  const compareRefs: Array<{ ref: CandidateRef; lineIdx: number; decision: Decision }> = [];

  for (const [ref, decision] of decisions) {
    if (decision.compare) {
      compareRefs.push({ ref, lineIdx: parseRefLine(ref), decision });
    }
  }

  // Sort by line index for ascending order output
  compareRefs.sort((a, b) => a.lineIdx - b.lineIdx);

  // Process compare decisions
  for (const { lineIdx, decision } of compareRefs) {
    const compare = decision.compare!;

    // Skip ties and both_bad
    if (compare.preference === 'tie') {
      excludedTies++;
      continue;
    }
    if (compare.preference === 'both_bad') {
      excludedBothBad++;
      continue;
    }

    // Check if record is unparseable
    if (isUnparseable && isUnparseable(lineIdx)) {
      skippedUnparseable++;
      continue;
    }

    const record = getRecord(lineIdx);
    if (record === undefined) {
      skippedUnparseable++;
      continue;
    }

    // Build pair based on format
    const pair = buildPairFromCompare(record, compare, format);
    if (pair) {
      if ('prompt' in pair === false) {
        implicitPromptCount++;
      }
      pairs.push(pair);
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

/**
 * Build a TRL pair from a compare decision.
 */
function buildPairFromCompare(
  record: unknown,
  compare: NonNullable<Decision['compare']>,
  format: RecordFormat
): TrlPair | null {
  const isLeft = compare.preference === 'left';

  switch (format.kind) {
    case 'messages': {
      // Candidate is last assistant turn, prompt is everything before
      const messages = getPath(record, format.path) as unknown[] | undefined;
      if (!Array.isArray(messages) || messages.length === 0) return null;

      // Find last assistant turn
      let lastAssistantIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as Record<string, unknown>;
        const role = String(msg[format.roleKey] ?? '');
        if (format.roles.assistant.includes(role)) {
          lastAssistantIdx = i;
          break;
        }
      }

      if (lastAssistantIdx < 0) return null;

      // Normalise all messages
      const normalised = messages.map((m) =>
        normaliseMessage(m as Record<string, unknown>, format)
      );

      const prompt = normalised.slice(0, lastAssistantIdx);
      const chosen = [normalised[lastAssistantIdx]];
      const rejected = [normalised[lastAssistantIdx]]; // same for compare without edit

      // For compare, we don't have different chosen/rejected from edits
      // The preference indicates which candidate is better
      // But in messages format with single record, we need two candidates
      // This case applies when comparing multiple records with same prompt (WP 5 grouping)
      // For now, return conversational pair with same chosen/rejected (placeholder)
      return {
        prompt,
        chosen: isLeft ? chosen : rejected,
        rejected: isLeft ? rejected : chosen,
      } as TrlPairConversational;
    }

    case 'flat': {
      const promptVal = getPath(record, format.promptPath);
      const responseVal = getPath(record, format.responsePath);

      if (typeof promptVal === 'string' && typeof responseVal === 'string') {
        return {
          prompt: promptVal,
          chosen: isLeft ? responseVal : responseVal,
          rejected: isLeft ? responseVal : responseVal,
        } as TrlPairStandard;
      }
      return null;
    }

    case 'preference': {
      const chosenVal = getPath(record, format.chosenPath);
      const rejectedVal = getPath(record, format.rejectedPath);

      if (format.promptPath) {
        const promptVal = getPath(record, format.promptPath);
        if (typeof promptVal === 'string') {
          return {
            prompt: promptVal,
            chosen: isLeft ? chosenVal : rejectedVal,
            rejected: isLeft ? rejectedVal : chosenVal,
          } as TrlPairStandard;
        }
      }

      // Implicit prompt (no promptPath)
      return {
        chosen: isLeft ? chosenVal : rejectedVal,
        rejected: isLeft ? rejectedVal : chosenVal,
      } as TrlPairImplicit;
    }

    case 'candidates': {
      const promptVal = getPath(record, format.promptPath);
      const candidates = getPath(record, format.candidatesPath) as unknown[] | undefined;

      if (!Array.isArray(candidates) || candidates.length < 2) return null;

      // Parse candidate indices from refs
      const leftIdx = parseInt(compare.left.split(':')[1] ?? '0', 10);
      const rightIdx = parseInt(compare.right.split(':')[1] ?? '1', 10);

      const chosenIdx = isLeft ? leftIdx : rightIdx;
      const rejectedIdx = isLeft ? rightIdx : leftIdx;

      if (typeof promptVal === 'string') {
        return {
          prompt: promptVal,
          chosen: candidates[chosenIdx],
          rejected: candidates[rejectedIdx],
        } as TrlPairStandard;
      }
      return null;
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
