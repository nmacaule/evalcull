/**
 * Review store for WP 3.
 * Implements §3.5 ReviewState interface.
 *
 * WP 5: Added regroupHandle registry and setFormat action.
 * WP 6c: Knockout over N candidates (compare[] per prompt), line refs, setStrength.
 */

import { create } from 'zustand';
import { losslessParse } from '../lib/lossless';
import {
  buildGroupLines,
  deriveKnockout,
  isInRecordFormat,
  promptCandidates,
  type GroupLines,
} from '../lib/knockout';
import type {
  RecordSource,
  RecordFormat,
  CandidateRef,
  Decision,
  FileIndex,
  HistoryAction,
  DecisionStatus,
  Preference,
  CompareDecision,
} from '../types';
import type {
  ParsedRecord,
  StorageState,
  SessionOutcome,
  EditValue,
} from './types';
import { formatPromptRef, parseRefLine } from './refs';
import { LRUCache } from './lru';
import {
  parseSessionText,
  serialiseSession,
  stateFromSession,
  loadFromIndexedDB,
  loadFromSidecar,
  hasSidecar,
  bumpSaveGeneration,
  getCurrentGeneration,
  scheduleSave,
  saveImmediate,
  onSavePendingChange,
  cancelPendingSaves,
} from './persistence';
import type { GroupResult } from '../readers/jsonl';

// -----------------------------------------------------------------------------
// Module-private record cache
// -----------------------------------------------------------------------------

const recordCache = new LRUCache<number, Promise<ParsedRecord>>(100);

function clearRecordCache(): void {
  recordCache.clear();
}

// -----------------------------------------------------------------------------
// Module-private regroup handle registry (WP 5)
// -----------------------------------------------------------------------------

type RegroupFn = (format: RecordFormat) => Promise<GroupResult>;
type DisposeFn = () => void;

interface RegroupHandle {
  regroup: RegroupFn;
  dispose: DisposeFn;
}

const regroupHandles = new Map<string, RegroupHandle>();

/**
 * Register regroup and dispose functions for a fingerprint.
 * Called by load() with the closures from the reader.
 */
export function registerRegroupHandle(
  fingerprint: string,
  regroup: RegroupFn,
  dispose: DisposeFn
): void {
  regroupHandles.set(fingerprint, { regroup, dispose });
}

/**
 * Clear regroup handle for a fingerprint and dispose the worker.
 */
export function clearRegroupHandle(fingerprint: string): void {
  const handle = regroupHandles.get(fingerprint);
  if (handle) {
    handle.dispose();
    regroupHandles.delete(fingerprint);
  }
}

// -----------------------------------------------------------------------------
// Module-private group sizes (WP 6c)
// -----------------------------------------------------------------------------

interface GroupSizes {
  table: GroupLines;
  /** n[g] = N, the number of candidates of group g. */
  n: Uint32Array;
  /** For N ≤ 1: the line of candidates[0]; −1 when N = 0. */
  reviewLine: Int32Array;
  /** What the entry was built for; rebuilt when either differs. */
  candidates: Uint16Array;
  inRecord: boolean;
}

/** Keyed by FileIndex.groups; a regroup replaces the array. */
const groupSizesCache = new WeakMap<Uint32Array, GroupSizes>();

/** N and the N ≤ 1 review line for every group, one O(lines) pass, cached. */
function groupSizes(index: FileIndex, format: RecordFormat): GroupSizes {
  const inRecord = isInRecordFormat(format);
  const cached = groupSizesCache.get(index.groups);
  if (
    cached &&
    cached.candidates === index.candidates &&
    cached.inRecord === inRecord &&
    cached.table.offsets.length === index.groupCount + 1
  ) {
    return cached;
  }

  const table = buildGroupLines(index.groups, index.groupCount);
  const n = new Uint32Array(index.groupCount);
  const reviewLine = new Int32Array(index.groupCount).fill(-1);
  for (let g = 0; g < index.groupCount; g++) {
    const start = table.offsets[g];
    const end = table.offsets[g + 1];
    if (!inRecord) {
      n[g] = end - start;
      if (end > start) reviewLine[g] = table.lines[start];
      continue;
    }
    let count = 0;
    for (let j = start; j < end; j++) {
      const line = table.lines[j];
      const c = index.candidates[line];
      if (c > 0 && reviewLine[g] === -1) reviewLine[g] = line;
      count += c;
    }
    n[g] = count;
  }

  const sizes: GroupSizes = { table, n, reviewLine, candidates: index.candidates, inRecord };
  groupSizesCache.set(index.groups, sizes);
  return sizes;
}

/** First line of group g; its ref holds the prompt's compare[]. */
function firstLineOf(sizes: GroupSizes, g: number): number {
  return sizes.table.lines[sizes.table.offsets[g]];
}

/** For N ≤ 1: the ref A/R/S act on, candidates[0] ?? promptRef. O(1). */
function reviewRefOf(sizes: GroupSizes, g: number): CandidateRef {
  const line = sizes.reviewLine[g];
  if (line === -1) return String(firstLineOf(sizes, g));
  return sizes.inRecord ? `${line}:0` : String(line);
}

/**
 * Whether ref names one of its prompt's candidates (Q12): a line ref for row
 * formats, "i:k" with k below line i's count for in-record formats, or the
 * review ref of a prompt with no candidates. O(1).
 */
function isCandidateEntry(sizes: GroupSizes, groups: Uint32Array, ref: CandidateRef): boolean {
  const line = parseRefLine(ref);
  const g = groups[line];
  if (sizes.n[g] === 0) return ref === reviewRefOf(sizes, g);
  if (!sizes.inRecord) return ref === String(line);
  const colon = ref.indexOf(':');
  return colon !== -1 && Number(ref.slice(colon + 1)) < sizes.candidates[line];
}

/** Whether any candidate entry of prompt g satisfies test (Q12). O(N). */
function someCandidate(
  state: ReviewState,
  sizes: GroupSizes,
  g: number,
  test: (d: Decision | undefined) => boolean
): boolean {
  if (sizes.n[g] === 0) return test(state.decisions.get(reviewRefOf(sizes, g)));
  const { offsets, lines } = sizes.table;
  for (let p = offsets[g]; p < offsets[g + 1]; p++) {
    const line = lines[p];
    if (!sizes.inRecord) {
      if (test(state.decisions.get(String(line)))) return true;
      continue;
    }
    for (let k = 0; k < sizes.candidates[line]; k++) {
      if (test(state.decisions.get(`${line}:${k}`))) return true;
    }
  }
  return false;
}

// -----------------------------------------------------------------------------
// State interface
// -----------------------------------------------------------------------------

export interface ReviewState {
  // Data
  source: RecordSource | null;
  sourceName: string;
  fingerprint: string;
  format: RecordFormat;
  decisions: Map<CandidateRef, Decision>;

  // Navigation & mode
  mode: 'compare' | 'single';
  cursor: number;
  focus: 0 | 1;

  // History
  past: HistoryAction[];
  future: HistoryAction[];

  // Filter
  filter:
    | 'all'
    | 'unreviewed'
    | 'kept'
    | 'rejected'
    | 'skipped'
    | 'edited'
    | 'unparseable';

  // Persistence state
  storageState: StorageState;
  lastSavedAt: number | null;
  session: SessionOutcome;
  newerLocalCopy: { savedAt: number } | null;

  // Dirty tracking for exportSession
  _dirty: boolean;
  _lastSerializedText: string | null;

  // Actions
  load(
    source: RecordSource,
    meta: { sourceName: string; fingerprint: string; format: RecordFormat },
    handle?: { regroup: RegroupFn; dispose: DisposeFn }
  ): Promise<void>;
  setFormat(format: RecordFormat): Promise<void>;
  record(i: number): Promise<ParsedRecord>;
  prefer(p: Preference, strength?: 1 | 2 | 3): void; // judges the pair shown (v3.3)
  setStrength(s: 1 | 2 | 3): void; // the pair just judged (v3.3)
  decide(ref: CandidateRef, status: DecisionStatus): void;
  edit(ref: CandidateRef, path: string, value: EditValue): void;
  setLabels(ref: CandidateRef, labels: string[]): void;
  setScore(ref: CandidateRef, score: number | undefined): void;
  setNotes(ref: CandidateRef, notes: string | undefined): void;
  undo(): void;
  redo(): void;
  next(): void;
  prev(): void;
  nextUnreviewed(): void;
  goTo(i: number): void;
  setFilter(f: ReviewState['filter']): void;
  setMode(m: 'compare' | 'single'): void;
  setFocus(f: 0 | 1): void;
  toggleFocus(): void;
  exportSession(): string;
  importSession(text: string, opts?: { force?: boolean }): Promise<void>;
  applyNewerLocalCopy(): Promise<void>;

  counts(): {
    total: number;
    reviewed: number;
    unreviewed: number;
    left: number;
    right: number;
    tie: number;
    bothBad: number;
    kept: number;
    rejected: number;
    skipped: number;
    edited: number;
    unparseable: number;
  };
}

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function getPromptCount(state: ReviewState): number {
  if (!state.source) return 0;
  if (state.source.kind === 'jsonl') {
    return state.mode === 'compare'
      ? state.source.index.groupCount
      : state.source.index.lineCount;
  }
  return state.source.count;
}

function deriveMode(format: RecordFormat, source: RecordSource): 'compare' | 'single' {
  // Rows sources have no grouping yet, so compare mode falls back to single (WP 5 i, D-009)
  if (source.kind !== 'jsonl') return 'single';
  if (format.kind === 'preference' || format.kind === 'candidates') {
    return 'compare';
  }
  // For JSONL with shared prompts (groupCount < lineCount), use compare
  if (source.kind === 'jsonl' && source.index.groupCount < source.index.lineCount) {
    return 'compare';
  }
  return 'single';
}

function clampCursor(cursor: number, total: number): number {
  if (total === 0) return 0;
  return Math.max(0, Math.min(cursor, total - 1));
}

/**
 * Deep equality check for RecordFormat.
 */
function formatEquals(a: RecordFormat, b: RecordFormat): boolean {
  if (a.kind !== b.kind) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function getOrCreateDecision(
  decisions: Map<CandidateRef, Decision>,
  ref: CandidateRef
): Decision {
  const existing = decisions.get(ref);
  if (existing) return existing;
  return { status: 'unreviewed', updatedAt: Date.now() };
}

/**
 * Prune a decision from the map if it has no meaningful state.
 * A decision is empty when: status is 'unreviewed', no compare, no labels
 * (or empty array), score is undefined, no notes, and no edits (or empty object).
 * An empty decision represents an untouched record and should not exist in the map.
 */
function pruneIfEmpty(
  decisions: Map<CandidateRef, Decision>,
  ref: CandidateRef
): void {
  const d = decisions.get(ref);
  if (!d) return;

  const hasStatus = d.status !== 'unreviewed';
  const hasCompare = d.compare !== undefined && d.compare.length > 0;
  const hasLabels = d.labels !== undefined && d.labels.length > 0;
  const hasScore = d.score !== undefined;
  const hasNotes = d.notes !== undefined;
  const hasEdits = d.edits !== undefined && Object.keys(d.edits).length > 0;

  if (!hasStatus && !hasCompare && !hasLabels && !hasScore && !hasNotes && !hasEdits) {
    decisions.delete(ref);
  }
}

/** Group sizes when the store is in compare mode over a JSONL source, else null. */
function compareSizes(state: ReviewState): GroupSizes | null {
  if (state.mode !== 'compare' || state.source?.kind !== 'jsonl') return null;
  return groupSizes(state.source.index, state.format);
}

/** The entry holding prompt idx's compare[]: its group's first line in compare mode. */
function promptEntry(
  state: ReviewState,
  sizes: GroupSizes | null,
  idx: number
): Decision | undefined {
  const ref = sizes ? String(firstLineOf(sizes, idx)) : formatPromptRef(idx);
  return state.decisions.get(ref);
}

/**
 * Review state of prompt idx (decision e). Compare mode: N ≥ 2 and all N−1 pairs
 * judged, or N ≤ 1 and candidates[0] ?? promptRef has a status. Single mode: the
 * line's status. Compare mode without a FileIndex keeps the earlier rule.
 */
function isReviewed(state: ReviewState, sizes: GroupSizes | null, idx: number): boolean {
  if (state.mode === 'compare') {
    if (!sizes) return !!state.decisions.get(formatPromptRef(idx))?.compare?.length;
    const n = sizes.n[idx];
    if (n >= 2) return (promptEntry(state, sizes, idx)?.compare?.length ?? 0) >= n - 1;
    const status = state.decisions.get(reviewRefOf(sizes, idx))?.status;
    return status !== undefined && status !== 'unreviewed';
  }
  const decision = state.decisions.get(formatPromptRef(idx));
  return !!decision && decision.status !== 'unreviewed';
}

/**
 * Set compare[pair] to value, or remove it when value is undefined (undo of an
 * append). The compare key is dropped when the array empties.
 */
function withComparePair(
  d: Decision,
  pair: number,
  value: CompareDecision | undefined
): Decision {
  const compare = [...(d.compare ?? [])];
  if (value === undefined) compare.splice(pair, 1);
  else compare[pair] = value;
  const { compare: _, ...rest } = d;
  return compare.length > 0
    ? { ...rest, compare, updatedAt: Date.now() }
    : { ...rest, updatedAt: Date.now() };
}

function findNextUnreviewed(
  state: ReviewState,
  startFrom: number,
  direction: 1 | -1 = 1
): number | null {
  const total = getPromptCount(state);
  if (total === 0) return null;
  const sizes = compareSizes(state);

  for (let i = 1; i <= total; i++) {
    const idx = (startFrom + i * direction + total) % total;
    if (!isReviewed(state, sizes, idx)) return idx;
  }
  return null;
}

/** Cursor for an undo/redo of ref: its group in compare mode, its line in single mode. */
function cursorForRef(state: ReviewState, ref: CandidateRef): number {
  const line = parseRefLine(ref);
  if (state.mode === 'compare' && state.source?.kind === 'jsonl') {
    const groups = state.source.index.groups;
    return line < groups.length ? groups[line] : 0;
  }
  return line;
}

/**
 * Binary search for value in sorted Uint32Array.
 */
function binarySearch(arr: Uint32Array, value: number): boolean {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midVal = arr[mid];
    if (midVal === value) return true;
    if (midVal < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function matchesFilter(
  state: ReviewState,
  idx: number
): boolean {
  if (state.filter === 'all') return true;

  // Compare mode: any candidate of the prompt matches (Q12); single mode the line's entry
  const sizes = compareSizes(state);
  const matches = (test: (d: Decision | undefined) => boolean) =>
    sizes ? someCandidate(state, sizes, idx, test) : test(promptEntry(state, sizes, idx));
  const isEdited = (d: Decision | undefined) => !!(d?.edits && Object.keys(d.edits).length > 0);

  switch (state.filter) {
    case 'unreviewed':
      return !isReviewed(state, sizes, idx);
    case 'kept':
      return matches((d) => d?.status === 'kept');
    case 'rejected':
      return matches((d) => d?.status === 'rejected');
    case 'skipped':
      return matches((d) => d?.status === 'skipped');
    case 'edited':
      return matches(isEdited);
    case 'unparseable':
      if (state.source?.kind === 'jsonl') {
        // idx is a group in compare mode; unparseable holds lines
        const line = sizes ? firstLineOf(sizes, idx) : idx;
        return binarySearch(state.source.index.unparseable, line);
      }
      return false;
    default:
      return true;
  }
}

function findNextMatchingFilter(
  state: ReviewState,
  startFrom: number,
  direction: 1 | -1
): number | null {
  const total = getPromptCount(state);
  if (total === 0) return null;

  for (let i = 1; i <= total; i++) {
    const idx = (startFrom + i * direction + total) % total;
    if (matchesFilter(state, idx)) return idx;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Store creation
// -----------------------------------------------------------------------------

export const useReviewStore = create<ReviewState>((set, get) => {
  // Schedule save helper
  function scheduleStoreSave(): void {
    const state = get();
    if (!state.source) return;

    const gen = getCurrentGeneration();
    scheduleSave({
      generation: gen,
      fingerprint: state.fingerprint,
      getText: () => {
        const s = get();
        const text = serialiseSession(
          {
            source: s.source,
            fingerprint: s.fingerprint,
            sourceName: s.sourceName,
            format: s.format,
            decisions: s.decisions,
            cursor: s.cursor,
            past: s.past,
          },
          () => Date.now()
        );
        set({ _dirty: false, _lastSerializedText: text });
        return text;
      },
      onSaved: (savedAt) => {
        if (getCurrentGeneration() !== gen) return;
        set({ storageState: { kind: 'saved' }, lastSavedAt: savedAt });
      },
      onError: (reason) => {
        if (getCurrentGeneration() !== gen) return;
        set({ storageState: { kind: 'error', message: reason } });
      },
      onIDBUnavailable: (reason) => {
        if (getCurrentGeneration() !== gen) return;
        set({ storageState: { kind: 'unavailable', reason } });
      },
    });

    set({ storageState: { kind: 'saving' }, _dirty: true });
  }

  // Push history and schedule save
  function pushHistory(action: HistoryAction): void {
    set((state) => ({
      past: [...state.past, action],
      future: [],
    }));
    scheduleStoreSave();
  }

  return {
    // Initial state
    source: null,
    sourceName: '',
    fingerprint: '',
    format: { kind: 'unknown' },
    decisions: new Map(),
    mode: 'single',
    cursor: 0,
    focus: 0,
    past: [],
    future: [],
    filter: 'all',
    storageState: { kind: 'idle' },
    lastSavedAt: null,
    session: { kind: 'fresh' },
    newerLocalCopy: null,
    _dirty: false,
    _lastSerializedText: null,

    async load(source, meta, handle) {
      // Clear cache and cancel pending saves
      clearRecordCache();
      bumpSaveGeneration();

      // Clear previous regroup handle (also disposes worker) and register new one
      const prevFp = get().fingerprint;
      if (prevFp) clearRegroupHandle(prevFp);
      if (handle) registerRegroupHandle(meta.fingerprint, handle.regroup, handle.dispose);

      // Derive mode from the provided format (no regroup on load)
      const detectedMode = deriveMode(meta.format, source);

      // Try to load existing session
      let sessionText: string | null = null;
      let newerLocalCopy: { savedAt: number } | null = null;

      // Try sidecar first
      if (hasSidecar()) {
        sessionText = await loadFromSidecar();
      }

      // Try IndexedDB if no sidecar
      const idbText = await loadFromIndexedDB(meta.fingerprint);

      if (sessionText && idbText) {
        // Both exist - check which is newer
        const sidecarResult = parseSessionText(sessionText);
        const idbResult = parseSessionText(idbText);

        if (sidecarResult.ok && idbResult.ok) {
          if (idbResult.session.savedAt > sidecarResult.session.savedAt) {
            newerLocalCopy = { savedAt: idbResult.session.savedAt };
          }
        }
      } else if (!sessionText && idbText) {
        sessionText = idbText;
      }

      // Parse and validate session
      if (sessionText) {
        const result = parseSessionText(sessionText);

        if (!result.ok) {
          set({
            source,
            sourceName: meta.sourceName,
            fingerprint: meta.fingerprint,
            format: meta.format,
            decisions: new Map(),
            mode: detectedMode,
            cursor: 0,
            focus: 0,
            past: [],
            future: [],
            session: {
              kind: 'refused',
              reason: result.reason.includes('version')
                ? 'unknown-version'
                : 'invalid-session',
              message: result.reason,
            },
            newerLocalCopy,
            storageState: { kind: 'idle' },
            _dirty: false,
            _lastSerializedText: null,
          });
          return;
        }

        // Check fingerprint
        if (result.session.fingerprint !== meta.fingerprint) {
          set({
            source,
            sourceName: meta.sourceName,
            fingerprint: meta.fingerprint,
            format: meta.format,
            decisions: new Map(),
            mode: detectedMode,
            cursor: 0,
            focus: 0,
            past: [],
            future: [],
            session: {
              kind: 'refused',
              reason: 'fingerprint-mismatch',
              message: `Session fingerprint ${result.session.fingerprint} does not match source ${meta.fingerprint}`,
            },
            newerLocalCopy,
            storageState: { kind: 'idle' },
            _dirty: false,
            _lastSerializedText: null,
          });
          return;
        }

        // Apply session
        const restored = stateFromSession(result.session);

        // If restored format differs from meta.format, regroup the index
        if (
          !formatEquals(meta.format, restored.format) &&
          source.kind === 'jsonl' &&
          handle
        ) {
          const regroupResult = await handle.regroup(restored.format);
          source.index.groups = regroupResult.groups;
          source.index.groupCount = regroupResult.groupCount;
          source.index.unparseable = regroupResult.unparseable;
          source.index.candidates = regroupResult.candidates;
        }

        const restoredMode = deriveMode(restored.format, source);
        const total =
          restoredMode === 'compare' && source.kind === 'jsonl'
            ? source.index.groupCount
            : source.kind === 'jsonl'
              ? source.index.lineCount
              : (source as { count: number }).count;

        set({
          source,
          sourceName: meta.sourceName,
          fingerprint: meta.fingerprint,
          format: restored.format,
          decisions: restored.decisions,
          mode: restoredMode,
          cursor: clampCursor(restored.cursor, total),
          focus: 0,
          past: restored.past,
          future: [],
          session: { kind: 'restored' },
          newerLocalCopy,
          storageState: { kind: 'idle' },
          lastSavedAt: result.session.savedAt,
          _dirty: false,
          // A migrated version-2 text is not what the next save writes (version 3)
          _lastSerializedText: result.migrated ? null : sessionText,
        });
        return;
      }

      // Fresh session - use format from meta (no regroup needed, already done by reader)
      set({
        source,
        sourceName: meta.sourceName,
        fingerprint: meta.fingerprint,
        format: meta.format,
        decisions: new Map(),
        mode: detectedMode,
        cursor: 0,
        focus: 0,
        past: [],
        future: [],
        session: { kind: 'fresh' },
        newerLocalCopy,
        storageState: { kind: 'idle' },
        lastSavedAt: null,
        _dirty: false,
        _lastSerializedText: null,
      });
    },

    async record(i) {
      const cached = recordCache.get(i);
      if (cached) return cached;

      const { source } = get();
      if (!source) {
        return { index: i, ok: false, error: 'No source loaded', raw: '' };
      }

      const promise = (async (): Promise<ParsedRecord> => {
        try {
          if (source.kind === 'jsonl') {
            const text = await source.readText(i);
            const data = losslessParse(text);
            return { index: i, ok: true, data };
          } else {
            const data = await source.readRow(i);
            return { index: i, ok: true, data };
          }
        } catch (err) {
          const raw =
            source.kind === 'jsonl'
              ? await source.readText(i).catch(() => '')
              : '';
          return { index: i, ok: false, error: String(err), raw };
        }
      })();

      recordCache.set(i, promise);
      promise.catch(() => recordCache.delete(i));
      return promise;
    },

    prefer(p, strength) {
      const state = get();
      if (state.mode !== 'compare') return; // No-op in single mode
      if (state.source?.kind !== 'jsonl') return; // Candidates come from the FileIndex
      const index = state.source.index;
      if (state.cursor >= index.groupCount) return;

      const sizes = groupSizes(index, state.format);
      const { promptRef, candidates } = promptCandidates(
        sizes.table,
        index.candidates,
        state.format,
        state.cursor
      );
      if (candidates.length < 2) return; // No pair to judge

      const existing = state.decisions.get(promptRef);
      const ks = deriveKnockout(candidates, existing?.compare);
      const shown = ks.shown!;
      const after: CompareDecision = {
        left: shown.left,
        right: shown.right,
        preference: p,
        strength,
      };

      // Append the pair shown, or replace the last pair of a completed prompt
      const compare = [...(existing?.compare ?? [])];
      let action: HistoryAction;
      if (ks.complete) {
        const before = compare[shown.pair];
        compare[shown.pair] = after;
        action = { type: 'compare', ref: promptRef, pair: shown.pair, before, after };
      } else {
        compare.push(after);
        action = { type: 'compare', ref: promptRef, pair: ks.judged, after };
      }

      const newDecision: Decision = {
        ...getOrCreateDecision(state.decisions, promptRef),
        compare,
        updatedAt: Date.now(),
      };

      const newDecisions = new Map(state.decisions);
      newDecisions.set(promptRef, newDecision);

      set({ decisions: newDecisions });
      pushHistory(action);

      // Auto-advance only once the prompt's last pair is judged
      if (compare.length < ks.totalPairs) return;
      const nextIdx = findNextUnreviewed(
        { ...state, decisions: newDecisions },
        state.cursor
      );
      if (nextIdx !== null && nextIdx !== state.cursor) {
        set({ cursor: nextIdx });
        scheduleStoreSave();
      }
    },

    setStrength(s) {
      const state = get();
      if (state.mode !== 'compare') return;

      // The pair recorded by the most recent compare action, whichever prompt it is on
      for (let i = state.past.length - 1; i >= 0; i--) {
        const action = state.past[i];
        if (action.type !== 'compare') continue;

        const existing = state.decisions.get(action.ref);
        const element = existing?.compare?.[action.pair];
        if (!existing || !element || element.strength === s) return;

        const after: CompareDecision = { ...element, strength: s };
        const compare = [...existing.compare!];
        compare[action.pair] = after;

        const newDecisions = new Map(state.decisions);
        newDecisions.set(action.ref, { ...existing, compare, updatedAt: Date.now() });

        set({ decisions: newDecisions });
        pushHistory({
          type: 'compare',
          ref: action.ref,
          pair: action.pair,
          before: element,
          after,
        });
        return;
      }
    },

    decide(ref, status) {
      const state = get();
      const existing = state.decisions.get(ref);
      const before = existing?.status ?? 'unreviewed';

      if (before === status) return; // No change

      const newDecision: Decision = {
        ...getOrCreateDecision(state.decisions, ref),
        status,
        updatedAt: Date.now(),
      };

      const newDecisions = new Map(state.decisions);
      newDecisions.set(ref, newDecision);
      pruneIfEmpty(newDecisions, ref);

      set({ decisions: newDecisions });
      pushHistory({ type: 'status', ref, before, after: status });

      // In single mode, auto-advance to next unreviewed
      if (state.mode === 'single') {
        const nextIdx = findNextUnreviewed(
          { ...state, decisions: newDecisions },
          state.cursor
        );
        if (nextIdx !== null && nextIdx !== state.cursor) {
          set({ cursor: nextIdx });
          scheduleStoreSave();
        }
      }
    },

    edit(ref, path, value) {
      const state = get();
      const existing = state.decisions.get(ref);
      const currentEdits = existing?.edits ?? {};
      const before = currentEdits[path]; // undefined if not yet edited

      // When value is undefined, remove the key (WP 6a: clearEdit for decision i)
      let newEdits: Record<string, EditValue>;
      if (value === undefined) {
        const { [path]: removed, ...rest } = currentEdits;
        void removed; // Consumed by destructuring
        newEdits = rest;
      } else {
        newEdits = { ...currentEdits, [path]: value };
      }

      const newDecision: Decision = {
        ...getOrCreateDecision(state.decisions, ref),
        edits: newEdits,
        updatedAt: Date.now(),
      };

      const newDecisions = new Map(state.decisions);
      newDecisions.set(ref, newDecision);
      pruneIfEmpty(newDecisions, ref);

      set({ decisions: newDecisions });
      pushHistory({ type: 'edit', ref, path, before, after: value });
    },

    setLabels(ref, labels) {
      const state = get();
      const existing = state.decisions.get(ref);
      const before = existing?.labels ?? [];

      const newDecision: Decision = {
        ...getOrCreateDecision(state.decisions, ref),
        labels,
        updatedAt: Date.now(),
      };

      const newDecisions = new Map(state.decisions);
      newDecisions.set(ref, newDecision);
      pruneIfEmpty(newDecisions, ref);

      set({ decisions: newDecisions });
      pushHistory({ type: 'labels', ref, before, after: labels });
    },

    setScore(ref, score) {
      const state = get();
      const existing = state.decisions.get(ref);
      const before = existing?.score;

      const newDecision: Decision = {
        ...getOrCreateDecision(state.decisions, ref),
        score,
        updatedAt: Date.now(),
      };

      const newDecisions = new Map(state.decisions);
      newDecisions.set(ref, newDecision);
      pruneIfEmpty(newDecisions, ref);

      set({ decisions: newDecisions });
      pushHistory({ type: 'score', ref, before, after: score });
    },

    setNotes(ref, notes) {
      const state = get();
      const existing = state.decisions.get(ref);
      const before = existing?.notes;

      const newDecision: Decision = {
        ...getOrCreateDecision(state.decisions, ref),
        notes,
        updatedAt: Date.now(),
      };

      const newDecisions = new Map(state.decisions);
      newDecisions.set(ref, newDecision);
      pruneIfEmpty(newDecisions, ref);

      set({ decisions: newDecisions });
      pushHistory({ type: 'notes', ref, before, after: notes });
    },

    undo() {
      const state = get();
      if (state.past.length === 0) return;

      const action = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, -1);
      const newFuture = [action, ...state.future];

      const ref = action.ref;
      const newDecisions = new Map(state.decisions);
      // Get existing or create base decision (decision may have been pruned)
      const existing = newDecisions.get(ref) ?? { status: 'unreviewed' as const, updatedAt: Date.now() };

      if (action.type === 'status') {
        newDecisions.set(ref, { ...existing, status: action.before, updatedAt: Date.now() });
      } else if (action.type === 'compare') {
        // An append (before undefined) is always the last pair: history is LIFO
        newDecisions.set(
          ref,
          withComparePair(existing, action.pair, action.before)
        );
      } else if (action.type === 'edit') {
        const edits = { ...existing.edits };
        if (action.before === undefined) {
          delete edits[action.path];
        } else {
          edits[action.path] = action.before;
        }
        if (Object.keys(edits).length === 0) {
          const { edits: _, ...rest } = existing;
          newDecisions.set(ref, { ...rest, updatedAt: Date.now() });
        } else {
          newDecisions.set(ref, { ...existing, edits, updatedAt: Date.now() });
        }
      } else if (action.type === 'labels') {
        newDecisions.set(ref, { ...existing, labels: action.before, updatedAt: Date.now() });
      } else if (action.type === 'score') {
        newDecisions.set(ref, { ...existing, score: action.before, updatedAt: Date.now() });
      } else if (action.type === 'notes') {
        newDecisions.set(ref, { ...existing, notes: action.before, updatedAt: Date.now() });
      }
      pruneIfEmpty(newDecisions, ref);

      set({
        past: newPast,
        future: newFuture,
        decisions: newDecisions,
        cursor: cursorForRef(state, ref), // Move cursor to affected prompt
      });
      scheduleStoreSave();
    },

    redo() {
      const state = get();
      if (state.future.length === 0) return;

      const action = state.future[0];
      const newFuture = state.future.slice(1);
      const newPast = [...state.past, action];

      const ref = action.ref;
      const newDecisions = new Map(state.decisions);
      const existing = newDecisions.get(ref) ?? { status: 'unreviewed', updatedAt: Date.now() };

      if (action.type === 'status') {
        newDecisions.set(ref, { ...existing, status: action.after, updatedAt: Date.now() });
      } else if (action.type === 'compare') {
        newDecisions.set(ref, withComparePair(existing, action.pair, action.after));
      } else if (action.type === 'edit') {
        const edits = { ...existing.edits, [action.path]: action.after };
        newDecisions.set(ref, { ...existing, edits, updatedAt: Date.now() });
      } else if (action.type === 'labels') {
        newDecisions.set(ref, { ...existing, labels: action.after, updatedAt: Date.now() });
      } else if (action.type === 'score') {
        newDecisions.set(ref, { ...existing, score: action.after, updatedAt: Date.now() });
      } else if (action.type === 'notes') {
        newDecisions.set(ref, { ...existing, notes: action.after, updatedAt: Date.now() });
      }
      pruneIfEmpty(newDecisions, ref);

      set({
        past: newPast,
        future: newFuture,
        decisions: newDecisions,
        cursor: cursorForRef(state, ref), // Move cursor to affected prompt
      });
      scheduleStoreSave();
    },

    next() {
      const state = get();
      const total = getPromptCount(state);
      if (total === 0) return;

      const nextIdx = findNextMatchingFilter(state, state.cursor, 1);
      if (nextIdx !== null && nextIdx !== state.cursor) {
        set({ cursor: nextIdx });
        scheduleStoreSave();
      }
    },

    prev() {
      const state = get();
      const total = getPromptCount(state);
      if (total === 0) return;

      const prevIdx = findNextMatchingFilter(state, state.cursor, -1);
      if (prevIdx !== null && prevIdx !== state.cursor) {
        set({ cursor: prevIdx });
        scheduleStoreSave();
      }
    },

    nextUnreviewed() {
      const state = get();
      const nextIdx = findNextUnreviewed(state, state.cursor);
      if (nextIdx !== null && nextIdx !== state.cursor) {
        set({ cursor: nextIdx });
        scheduleStoreSave();
      }
    },

    goTo(i) {
      const state = get();
      const total = getPromptCount(state);
      const clamped = clampCursor(i, total);
      if (clamped !== state.cursor) {
        set({ cursor: clamped });
        scheduleStoreSave();
      }
    },

    setFilter(f) {
      set({ filter: f });
    },

    setMode(m) {
      set({ mode: m });
    },

    async setFormat(format) {
      const state = get();

      // No-op if format is unchanged
      if (formatEquals(state.format, format)) {
        return;
      }

      if (!state.source || state.source.kind !== 'jsonl') {
        // setFormat only applies to JSONL sources
        set({ format });
        return;
      }

      const handle = regroupHandles.get(state.fingerprint);
      if (!handle) {
        // No regroup handle - just update format
        set({ format });
        return;
      }

      // Resolve current line before regrouping
      const oldGroups = state.source.index.groups;
      let currentLine: number;
      if (state.mode === 'compare') {
        // Find first line whose old group equals the cursor (group index)
        currentLine = 0;
        for (let i = 0; i < oldGroups.length; i++) {
          if (oldGroups[i] === state.cursor) {
            currentLine = i;
            break;
          }
        }
      } else {
        // Single mode: cursor is the line
        currentLine = state.cursor;
      }

      // Run regroup with new format
      const result = await handle.regroup(format);

      // Copy the regroup result into the index before anything reads it
      // (idempotent with the reader's in-place update)
      state.source.index.groups = result.groups;
      state.source.index.groupCount = result.groupCount;
      state.source.index.unparseable = result.unparseable;
      state.source.index.candidates = result.candidates;

      // Re-derive mode
      const newMode = deriveMode(format, state.source);

      // Map through new groups or keep as line
      let newCursor: number;
      if (newMode === 'compare') {
        // Map to new group
        newCursor = currentLine < result.groups.length ? result.groups[currentLine] : 0;
      } else {
        // Single mode: keep as line
        newCursor = currentLine;
      }

      // Clamp cursor
      const total = newMode === 'compare' ? result.groupCount : state.source.index.lineCount;
      newCursor = clampCursor(newCursor, total);

      set({
        format,
        mode: newMode,
        cursor: newCursor,
      });

      scheduleStoreSave();
    },

    setFocus(f) {
      set({ focus: f });
    },

    toggleFocus() {
      set((state) => ({ focus: state.focus === 0 ? 1 : 0 }));
    },

    exportSession() {
      const state = get();
      if (!state.source) {
        throw new Error('Cannot export: no source loaded');
      }

      // If dirty, flush and return that text
      if (state._dirty || !state._lastSerializedText) {
        const text = serialiseSession(
          {
            source: state.source,
            fingerprint: state.fingerprint,
            sourceName: state.sourceName,
            format: state.format,
            decisions: state.decisions,
            cursor: state.cursor,
            past: state.past,
          },
          () => Date.now()
        );
        set({ _dirty: false, _lastSerializedText: text });
        return text;
      }

      return state._lastSerializedText;
    },

    async importSession(text, opts) {
      const state = get();

      // Clear cache and cancel pending saves
      clearRecordCache();
      bumpSaveGeneration();

      const result = parseSessionText(text);

      if (!result.ok) {
        const reason = result.reason.includes('version')
          ? 'unknown-version'
          : 'invalid-session';
        set({
          session: { kind: 'refused', reason, message: result.reason },
        });
        return;
      }

      // A supported version is required even with force (v2 is migrated to 3 on parse)
      if (result.session.version !== 3) {
        set({
          session: {
            kind: 'refused',
            reason: 'unknown-version',
            message: `Version ${result.session.version} not supported`,
          },
        });
        return;
      }

      // Check fingerprint (unless force)
      if (
        !opts?.force &&
        result.session.fingerprint !== state.fingerprint
      ) {
        set({
          session: {
            kind: 'refused',
            reason: 'fingerprint-mismatch',
            message: `Session fingerprint ${result.session.fingerprint} does not match source ${state.fingerprint}`,
          },
        });
        return;
      }

      // Apply session with live fingerprint
      const restored = stateFromSession(result.session);

      // If imported format differs from current, regroup the index
      if (
        state.source?.kind === 'jsonl' &&
        !formatEquals(state.format, restored.format)
      ) {
        const handle = regroupHandles.get(state.fingerprint);
        if (handle) {
          const regroupResult = await handle.regroup(restored.format);
          state.source.index.groups = regroupResult.groups;
          state.source.index.groupCount = regroupResult.groupCount;
          state.source.index.unparseable = regroupResult.unparseable;
          state.source.index.candidates = regroupResult.candidates;
        }
      }

      const importedMode = state.source
        ? deriveMode(restored.format, state.source)
        : 'single';
      const total =
        importedMode === 'compare' && state.source?.kind === 'jsonl'
          ? state.source.index.groupCount
          : state.source?.kind === 'jsonl'
            ? state.source.index.lineCount
            : getPromptCount(state);

      set({
        format: restored.format,
        decisions: restored.decisions,
        mode: importedMode,
        cursor: clampCursor(restored.cursor, total),
        past: restored.past,
        future: [],
        session: { kind: 'restored' },
        newerLocalCopy: null,
        _dirty: true,
        _lastSerializedText: null,
      });

      scheduleStoreSave();
    },

    async applyNewerLocalCopy() {
      const state = get();
      if (!state.newerLocalCopy) return;

      const text = await loadFromIndexedDB(state.fingerprint);
      if (text) {
        await get().importSession(text, { force: true });
        set({ newerLocalCopy: null });
      }
    },

    counts() {
      const state = get();
      const total = getPromptCount(state);

      let reviewed = 0;
      let unreviewed = 0;
      let left = 0;
      let right = 0;
      let tie = 0;
      let bothBad = 0;
      let kept = 0;
      let rejected = 0;
      let skipped = 0;
      let edited = 0;

      // Left/right/tie/both_bad count judged pairs (§2.8, v3.3)
      const tally = (compare: CompareDecision[] | undefined) => {
        for (const c of compare ?? []) {
          if (c.preference === 'left') left++;
          else if (c.preference === 'right') right++;
          else if (c.preference === 'tie') tie++;
          else bothBad++;
        }
      };
      const tallyStatus = (decision: Decision) => {
        if (decision.status === 'kept') kept++;
        if (decision.status === 'rejected') rejected++;
        if (decision.status === 'skipped') skipped++;
        if (decision.edits && Object.keys(decision.edits).length > 0) edited++;
      };

      // Iterate the sparse decisions map, not every prompt: O(entries + pairs)
      const sizes = compareSizes(state);
      if (sizes && state.source?.kind === 'jsonl') {
        const index = state.source.index;
        for (const [ref, decision] of state.decisions) {
          const line = parseRefLine(ref);
          if (line >= index.lineCount) continue;
          const g = index.groups[line];
          const n = sizes.n[g];
          const isPrompt = ref === String(line) && firstLineOf(sizes, g) === line;

          // Each group counts once: its prompt entry (N ≥ 2) or its review ref (N ≤ 1)
          if (n >= 2) {
            if (isPrompt && (decision.compare?.length ?? 0) >= n - 1) reviewed++;
          } else if (ref === reviewRefOf(sizes, g) && decision.status !== 'unreviewed') {
            reviewed++;
          }

          if (isPrompt) tally(decision.compare);
          // Kept, rejected, skipped and edited count candidates (Q12); an entry
          // that names no candidate of its prompt is not counted
          if (isCandidateEntry(sizes, index.groups, ref)) tallyStatus(decision);
        }
        unreviewed = total - reviewed;
      } else {
        // Earlier rule: one entry per prompt or line, keyed by its index
        let touched = 0;
        let unreviewedEntries = 0;
        for (const [ref, decision] of state.decisions) {
          const line = parseRefLine(ref);
          if (ref !== String(line) || line >= total) continue;
          touched++;

          tally(decision.compare);
          // Same rule as isReviewed: compare decisions in compare mode, status in single mode (D-002)
          if (state.mode === 'compare' ? !!decision.compare?.length : decision.status !== 'unreviewed') {
            reviewed++;
          }
          tallyStatus(decision);

          if (state.mode === 'compare') {
            if (!decision.compare?.length) unreviewedEntries++;
          } else if (decision.status === 'unreviewed') {
            unreviewedEntries++;
          }
        }
        unreviewed = total - touched + unreviewedEntries;
      }

      // Get unparseable count from index
      let unparseableCount = 0;
      if (state.source?.kind === 'jsonl') {
        unparseableCount = state.source.index.unparseable.length;
      }

      return {
        total,
        reviewed,
        unreviewed,
        left,
        right,
        tie,
        bothBad,
        kept,
        rejected,
        skipped,
        edited,
        unparseable: unparseableCount,
      };
    },
  };
});

// -----------------------------------------------------------------------------
// Page lifecycle handlers
// -----------------------------------------------------------------------------

// fetch keepalive bodies are capped at 64 KiB (Fetch standard)
const KEEPALIVE_QUOTA_BYTES = 65536;

/** Ask the browser to confirm closing while a save is pending or in flight (D-005 G). */
function confirmCloseWhileSaving(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}

if (typeof window !== 'undefined') {
  // Registered only while unsaved, so the back/forward cache is unaffected otherwise
  onSavePendingChange((pending) => {
    if (pending) window.addEventListener('beforeunload', confirmCloseWhileSaving);
    else window.removeEventListener('beforeunload', confirmCloseWhileSaving);
  });

  window.addEventListener('pagehide', () => {
    const state = useReviewStore.getState();
    if (!state.source || !state._dirty) return;

    const gen = getCurrentGeneration();
    const text = serialiseSession(
      {
        source: state.source,
        fingerprint: state.fingerprint,
        sourceName: state.sourceName,
        format: state.format,
        decisions: state.decisions,
        cursor: state.cursor,
        past: state.past,
      },
      () => Date.now()
    );

    // Browsers refuse a keepalive body over the quota, so a larger session
    // goes as an ordinary request (D-005 A); IndexedDB is written first (B)
    const keepalive = new TextEncoder().encode(text).length <= KEEPALIVE_QUOTA_BYTES;
    saveImmediate(
      {
        generation: gen,
        fingerprint: state.fingerprint,
        getText: () => text,
        onSaved: () => {},
        onError: () => {},
        onIDBUnavailable: () => {},
      },
      { keepalive, idbFirst: true }
    );
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const state = useReviewStore.getState();
      if (state.source && state._dirty) {
        // Flush pending save
        cancelPendingSaves();
        const gen = getCurrentGeneration();
        const text = serialiseSession(
          {
            source: state.source,
            fingerprint: state.fingerprint,
            sourceName: state.sourceName,
            format: state.format,
            decisions: state.decisions,
            cursor: state.cursor,
            past: state.past,
          },
          () => Date.now()
        );

        saveImmediate(
          {
            generation: gen,
            fingerprint: state.fingerprint,
            getText: () => text,
            onSaved: (savedAt) => {
              useReviewStore.setState({
                storageState: { kind: 'saved' },
                lastSavedAt: savedAt,
                _dirty: false,
                _lastSerializedText: text,
              });
            },
            onError: (reason) => {
              useReviewStore.setState({
                storageState: { kind: 'error', message: reason },
              });
            },
            onIDBUnavailable: (reason) => {
              useReviewStore.setState({
                storageState: { kind: 'unavailable', reason },
              });
            },
          },
          // The page may be closing: write IndexedDB before the PUT (D-005 B)
          { idbFirst: true }
        );
      }
    }
  });
}
