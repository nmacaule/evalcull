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
  SwitchState,
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
  flushPendingSave,
  isSavePending,
  FLUSH_MAX_WAIT_MS,
  saveLatestToIndexedDB,
  onSavePendingChange,
  cancelPendingSaves,
  type SaveContext,
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
// A cancelled switch kept for Open anyway, discarding changes (DR-001 B-i)
type HeldSwitch = { run: () => Promise<void>; dispose: () => void };
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
function registerRegroupHandle(
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
  // The newer copy's text, read once at load and held with the offer as per-file state (D-075)
  _newerLocalCopyText: string | null;
  // The store-owned file switch, read by the app for "a file is opening" (DR-001)
  switching: SwitchState;
  // A switch cancelled because the current file's changes reached no sink (D-041, DR-001 B-i)
  cancelledSwitch: { name: string } | null;
  // Wait for {name} to open. after a request refused while a switch opens (D-056), or
  // Re-grouping for the format failed: {reason} after a format change's regroup failed (D-076)
  switchNotice: string | null;
  // The switch's working state and the unsaved mark (D-066): read and written only by the store
  _switchReserved: boolean;
  _switchRunning: boolean;
  _heldSwitch: HeldSwitch | null;
  _changeSeq: number;
  _sinkedSeq: number;
  _exportedChangeSeq: number;

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
  // request: the caller's object for this one load, carried in its refusal (D-088)
  importSession(text: string, opts?: { force?: boolean; name?: string; request?: object }): Promise<void>;
  applyNewerLocalCopy(): Promise<void>;
  // A file is being read before load() (the Dropzone): the switch is held from
  // here, and the first load() claims it; false when another switch is opening
  beginOpening(name: string): boolean;
  endOpening(): void;
  // True, with the notice set, when a switch is opening and a new request must wait (D-056)
  refuseWhileOpening(): boolean;
  // The cancelled switch goes ahead, discarding the current file's unsaved changes (DR-001 B-i)
  openAnywayDiscarding(): Promise<void>;
  // A session download handed to the browser clears the unsaved mark (DR-001 refinement 1)
  noteSessionDownloaded(): void;

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

/**
 * Flush until no save is pending, waiting FLUSH_MAX_WAIT_MS in all (PRD §2.7:
 * opening another file saves the pending changes first, waiting at most 5 s
 * for the sidecar; D-029, D-032, D-034).
 */
async function flushUntilSettled(): Promise<boolean> {
  const deadline = Date.now() + FLUSH_MAX_WAIT_MS;
  while (isSavePending()) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    if (!(await flushPendingSave(left))) return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// Store creation
// -----------------------------------------------------------------------------

// The store's save context, for the page-hide and visibility flushes below (D-057)
let makeFlushContext: ((text: string) => SaveContext) | null = null;

export const useReviewStore = create<ReviewState>((set, get) => {
  // ---------------------------------------------------------------------------
  // The file switch (PRD §2.7, §3.5; DR-001). Module-private: a counter taken
  // at each switch's start, a reservation held while a file is read before
  // load(), and the held request of a cancelled switch for Open anyway.
  // ---------------------------------------------------------------------------
  let switchCounter = 0;
  // The switch's working state and the per-file unsaved mark live in the store
  // as underscore fields, so a store reset clears them with the rest (D-066).
  // The mark (DR-001 rule 3): every change increments changeSeq; a text that
  // reached the sidecar or IndexedDB, or a session download, moves sinkedSeq up
  // to the change it was taken at. Counters, not timestamps (PRD S116, S117)
  const priv = {
    get switchReserved() {
      return get()._switchReserved;
    },
    set switchReserved(v: boolean) {
      set({ _switchReserved: v });
    },
    get switchRunning() {
      return get()._switchRunning;
    },
    set switchRunning(v: boolean) {
      set({ _switchRunning: v });
    },
    // Read only: the held request is written together with cancelledSwitch, in one set (D-068)
    get heldSwitch() {
      return get()._heldSwitch;
    },
    get changeSeq() {
      return get()._changeSeq;
    },
    set changeSeq(v: number) {
      set({ _changeSeq: v });
    },
    get sinkedSeq() {
      return get()._sinkedSeq;
    },
    set sinkedSeq(v: number) {
      set({ _sinkedSeq: v });
    },
    get exportedChangeSeq() {
      return get()._exportedChangeSeq;
    },
    set exportedChangeSeq(v: number) {
      set({ _exportedChangeSeq: v });
    },
  };
  const hasUnsaved = () => priv.sinkedSeq < priv.changeSeq;
  const markSinked = (seq: number) => {
    if (seq > priv.sinkedSeq) priv.sinkedSeq = seq;
  };

  interface SwitchCtx {
    // After every await: the switch is still the current one and the store
    // still holds the file it started on (DR-001 rule 2)
    current(): boolean;
  }

  // A request refused while a switch is opening: the store's notice is the one
  // place that says so (DR-001 rule 1, D-056); cleared when that switch ends
  function noteRefusal(opening: string): void {
    set({ switchNotice: `Wait for ${opening} to open.` });
  }

  // One switch at a time (DR-001 rule 1): a request while another is opening
  // is refused; a reservation from beginOpening is claimed only by a load(),
  // the dropped file's own (D-055)
  async function runSwitch(
    name: string,
    body: (ctx: SwitchCtx) => Promise<void>,
    onRefused: (opening: string) => void,
    claimsReservation = false
  ): Promise<void> {
    const sw = get().switching;
    if (sw.kind === 'opening') {
      if (!claimsReservation || !priv.switchReserved || priv.switchRunning) {
        noteRefusal(sw.name);
        onRefused(sw.name);
        return;
      }
      priv.switchReserved = false;
    } else {
      set({ switching: { kind: 'opening', name }, switchNotice: null });
    }
    priv.switchRunning = true;
    const mine = ++switchCounter;
    const fingerprint = get().fingerprint;
    try {
      await body({ current: () => switchCounter === mine && get().fingerprint === fingerprint });
    } finally {
      priv.switchRunning = false;
      if (switchCounter === mine) set({ switching: { kind: 'idle' }, switchNotice: null });
    }
  }

  // The held request of a cancelled switch is released when another starts
  // The held request and the actions that offer it go together, in one step (D-067)
  function releaseHeldSwitch(): void {
    const held = get()._heldSwitch;
    set({ _heldSwitch: null, cancelledSwitch: null });
    held?.dispose();
  }

  // Cancel the switch and hold it for Open anyway, discarding changes (D-041, DR-001 B-i)
  function cancelSwitch(name: string, reason: string, held: { run: () => Promise<void>; dispose: () => void }): void {
    releaseHeldSwitch();
    // The held request and the actions that offer it in one set (D-068)
    set({
      _heldSwitch: held,
      storageState: {
        kind: 'not-saved',
        message: `The current file's changes could not be saved: ${reason}. Download the session to keep them.`,
      },
      cancelledSwitch: { name },
    });
  }

  // The new file is committed: the old file's saves stop, and its per-file
  // marks and caches go (DR-001 rule 4)
  function commitNewFile(): void {
    bumpSaveGeneration();
    clearRecordCache();
  }

  // The per-file unsaved-mark counters of a new file, written in the commit's one set (D-070)
  const freshMark = { _changeSeq: 0, _sinkedSeq: 0, _exportedChangeSeq: -1 };

  // The current session's latest text to IndexedDB, when a file switch stops
  // waiting for the save in flight (D-036)
  async function writeCurrentToIndexedDB(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const s = get();
    if (!s.source) return { ok: true };
    const seq = priv.changeSeq;
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
    const written = await saveLatestToIndexedDB(s.fingerprint, text);
    if (written.ok) markSinked(seq);
    return written;
  }

  // Before leaving the current file (DR-001 rule 3): flush the pending save
  // (D-029, D-032, at most 5 s, D-034); while changes remain that reached no
  // sink, IndexedDB gets the latest text (D-036). The reason when they still
  // reached none (D-041, D-046); null when the switch may go ahead.
  async function saveBeforeLeaving(): Promise<string | null> {
    if (!get().source) return null;
    if (isSavePending()) await flushUntilSettled();
    // Until the mark is clear: a change made during a write is written too (D-058)
    while (hasUnsaved()) {
      const written = await writeCurrentToIndexedDB();
      if (!written.ok) return written.reason;
    }
    return null;
  }

  // The current session's text; the caller records the change it was taken at
  function takeText(): string {
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
  }

  // One save context for every save of the current file, the scheduled one and
  // the page-hide and visibility flushes alike: it clears the unsaved mark when
  // the text reaches a sink, and follows D-043's rule for the not-saved message (D-057)
  function storeSaveContext(text?: string): SaveContext {
    const gen = getCurrentGeneration();
    // The change this context's own text was taken at: a flush takes its text
    // now, a scheduled save when it runs. A text that reached a sink advances
    // the mark to that number and no further (DR-001 rule 3, D-063)
    let ownSeq = priv.changeSeq;
    if (text !== undefined) set({ _dirty: false, _lastSerializedText: text });
    return {
      generation: gen,
      fingerprint: get().fingerprint,
      getText:
        text !== undefined
          ? () => text
          : () => {
              ownSeq = priv.changeSeq;
              return takeText();
            },
      onPersisted: () => {
        if (getCurrentGeneration() !== gen) return;
        markSinked(ownSeq);
      },
      onSaved: (savedAt) => {
        if (getCurrentGeneration() !== gen) return;
        // A save that succeeds replaces a cancelled switch's message (D-043)
        if (get().cancelledSwitch) releaseHeldSwitch();
        set({ storageState: { kind: 'saved' }, lastSavedAt: savedAt, cancelledSwitch: null });
      },
      // After a cancelled switch only a successful save replaces its message (D-043)
      onError: (reason) => {
        if (getCurrentGeneration() !== gen || get().storageState.kind === 'not-saved') return;
        set({ storageState: { kind: 'error', message: reason } });
      },
      onIDBUnavailable: (reason) => {
        if (getCurrentGeneration() !== gen || get().storageState.kind === 'not-saved') return;
        set({ storageState: { kind: 'unavailable', reason } });
      },
    };
  }
  makeFlushContext = storeSaveContext;

  // Schedule save helper
  function scheduleStoreSave(): void {
    if (!get().source) return;
    priv.changeSeq++;
    scheduleSave(storeSaveContext());

    if (get().storageState.kind === 'not-saved') set({ _dirty: true });
    else set({ storageState: { kind: 'saving' }, _dirty: true });
  }

  // A switch that finds the file or session changed during a wait is refused (D-042, D-045; DR-001 rule 2)
  function refuseSuperseded(): void {
    set({
      session: {
        kind: 'refused',
        reason: 'superseded',
        message: 'Another file or session opened while this session waited for the save. Load the session again.',
      },
    });
  }

  // A session applied to the current file, inside a switch
  async function importBody(
    ctx: SwitchCtx,
    text: string,
    opts: { force?: boolean; discard?: boolean; name?: string; request?: object }
  ): Promise<void> {
    // What the switch reports while it opens, the session file's name when given (PRD §3.5, D-073)
    const name = opts.name ?? 'the session';
    const state = get();

    // Validate before touching the save schedule: a refusal leaves the
    // decisions, the cursor and the pending save as they are (D-029)
    const result = parseSessionText(text);

    if (!result.ok) {
      const reason = result.reason.includes('version') ? 'unknown-version' : 'invalid-session';
      set({ session: { kind: 'refused', reason, message: result.reason, name: opts.name, request: opts.request } });
      return;
    }

    // A supported version is required even with force (v2 is migrated to 3 on parse)
    if (result.session.version !== 3) {
      set({
        session: {
          kind: 'refused',
          reason: 'unknown-version',
          message: `Version ${result.session.version} not supported`,
          name: opts.name,
          request: opts.request,
        },
      });
      return;
    }

    // Check fingerprint (unless force)
    if (!opts.force && result.session.fingerprint !== state.fingerprint) {
      set({
        session: {
          kind: 'refused',
          reason: 'fingerprint-mismatch',
          message: `Session fingerprint ${result.session.fingerprint} does not match source ${state.fingerprint}`,
          name: opts.name,
          request: opts.request,
        },
      });
      return;
    }

    // Save the current changes first (D-029, D-041; DR-001 rule 3), unless the
    // user chose to discard them; awaited only when there is something to save,
    // so an import with nothing pending applies at once. False when the import stops
    const needsSave = () => !opts.discard && (isSavePending() || hasUnsaved());
    const saveFirst = async (): Promise<boolean> => {
      const notSaved = await saveBeforeLeaving();
      if (!ctx.current()) {
        refuseSuperseded();
        return false;
      }
      if (notSaved !== null) {
        cancelSwitch(name, notSaved, {
          run: () => runSwitch(name, (c) => importBody(c, text, { ...opts, discard: true }), () => {}),
          dispose: () => {},
        });
        return false;
      }
      return true;
    };
    if (needsSave() && !(await saveFirst())) return;

    // Apply session with live fingerprint
    const restored = stateFromSession(result.session);

    // If imported format differs from current, regroup the index
    let regroupResult: GroupResult | null = null;
    if (state.source?.kind === 'jsonl' && !formatEquals(state.format, restored.format)) {
      const handle = regroupHandles.get(state.fingerprint);
      if (handle) {
        // A regroup that fails stops the import, changing nothing, and says so (D-076)
        try {
          regroupResult = await handle.regroup(restored.format);
        } catch (err) {
          set({
            session: {
              kind: 'refused',
              reason: 'regroup-failed',
              message: `Re-grouping for the session's format failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          });
          return;
        }
        if (!ctx.current()) return refuseSuperseded();
      }
    }

    // A change made during the regroup is saved before the session replaces it (D-058)
    if (needsSave() && !(await saveFirst())) return;
    if (regroupResult && state.source?.kind === 'jsonl') {
      state.source.index.groups = regroupResult.groups;
      state.source.index.groupCount = regroupResult.groupCount;
      state.source.index.unparseable = regroupResult.unparseable;
      state.source.index.candidates = regroupResult.candidates;
    }

    // The old session's saves stop here; the imported one is saved next
    bumpSaveGeneration();
    clearRecordCache();

    const importedMode = state.source ? deriveMode(restored.format, state.source) : 'single';
    const total =
      importedMode === 'compare' && state.source?.kind === 'jsonl'
        ? state.source.index.groupCount
        : state.source?.kind === 'jsonl'
          ? state.source.index.lineCount
          : getPromptCount(state);

    // A held cancelled switch goes only now, the import certain to apply (D-080)
    const held = get()._heldSwitch;
    set({
      _heldSwitch: null,
      cancelledSwitch: null,
      format: restored.format,
      decisions: restored.decisions,
      mode: importedMode,
      cursor: clampCursor(restored.cursor, total),
      past: restored.past,
      future: [],
      session: { kind: 'restored' },
      newerLocalCopy: null,
      _newerLocalCopyText: null,
      _dirty: true,
      _lastSerializedText: null,
    });
    held?.dispose();

    scheduleStoreSave();
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
    _newerLocalCopyText: null,
    switching: { kind: 'idle' },
    cancelledSwitch: null,
    switchNotice: null,
    _switchReserved: false,
    _switchRunning: false,
    _heldSwitch: null,
    _changeSeq: 0,
    _sinkedSeq: 0,
    _exportedChangeSeq: -1,
    _dirty: false,
    _lastSerializedText: null,

    async load(source, meta, handle) {
      const discardRun = { discard: false };
      const run = async (ctx: SwitchCtx): Promise<void> => {
        // The new file's reader is released if the switch does not reach its commit
        const abandon = () => handle?.dispose();
        const held = {
          run: () => {
            discardRun.discard = true;
            return runSwitch(meta.sourceName, run, abandon);
          },
          dispose: abandon,
        };

        // Leave the current file only once its changes reached a sink (D-029,
        // D-041, D-046; DR-001 rule 3), unless the user chose to discard them
        if (!discardRun.discard && get().source && (isSavePending() || hasUnsaved())) {
          const notSaved = await saveBeforeLeaving();
          if (!ctx.current()) return abandon();
          if (notSaved !== null) return cancelSwitch(meta.sourceName, notSaved, held);
        }

        // Derive mode from the provided format (no regroup on load)
        const detectedMode = deriveMode(meta.format, source);

        // Try to load existing session
        let sessionText: string | null = null;
        let newerLocalCopy: { savedAt: number } | null = null;
        let newerLocalCopyText: string | null = null;

        // Try sidecar first
        if (hasSidecar()) {
          sessionText = await loadFromSidecar();
          if (!ctx.current()) return abandon();
        }

        // Try IndexedDB if no sidecar
        const idbText = await loadFromIndexedDB(meta.fingerprint);
        if (!ctx.current()) return abandon();

        if (sessionText && idbText) {
          // Both exist - check which is newer
          const sidecarResult = parseSessionText(sessionText);
          const idbResult = parseSessionText(idbText);

          if (sidecarResult.ok && idbResult.ok) {
            if (idbResult.session.savedAt > sidecarResult.session.savedAt) {
              newerLocalCopy = { savedAt: idbResult.session.savedAt };
              newerLocalCopyText = idbText;
            }
          }
        } else if (!sessionText && idbText) {
          sessionText = idbText;
        }

        // Every per-file field (DR-001 rule 5); the filter is a view preference and is kept
        const perFile = {
          source,
          sourceName: meta.sourceName,
          fingerprint: meta.fingerprint,
          format: meta.format,
          decisions: new Map<CandidateRef, Decision>(),
          mode: detectedMode,
          cursor: 0,
          focus: 0 as const,
          past: [] as HistoryAction[],
          future: [] as HistoryAction[],
          session: { kind: 'fresh' } as SessionOutcome,
          newerLocalCopy,
          _newerLocalCopyText: newerLocalCopyText,
          storageState: { kind: 'idle' } as StorageState,
          lastSavedAt: null as number | null,
          cancelledSwitch: null,
          _dirty: false,
          _lastSerializedText: null as string | null,
        };

        // A change made on the current file during the reads is saved before leaving it too
        const leave = async (): Promise<boolean> => {
          if (discardRun.discard || !hasUnsaved()) return true;
          const notSaved = await saveBeforeLeaving();
          if (!ctx.current()) {
            abandon();
            return false;
          }
          if (notSaved !== null) {
            cancelSwitch(meta.sourceName, notSaved, held);
            return false;
          }
          return true;
        };

        // The commit: the new file's state and the save generation in one step (DR-001 rule 4)
        // The new file's state and its counters in one set; the old file's
        // regroup handle is disposed after that set, not before (D-070)
        const commit = (fields: Partial<ReviewState>) => {
          commitNewFile();
          const prevFp = get().fingerprint;
          const prevHandle = prevFp ? regroupHandles.get(prevFp) : undefined;
          if (prevFp) regroupHandles.delete(prevFp);
          if (handle) registerRegroupHandle(meta.fingerprint, handle.regroup, handle.dispose);
          // A held cancelled switch goes only now, the switch certain to go ahead (D-080)
          const held = get()._heldSwitch;
          set({ ...perFile, ...fields, ...freshMark, _heldSwitch: null });
          if (prevHandle && prevHandle.dispose !== handle?.dispose) prevHandle.dispose();
          held?.dispose();
        };

        // Parse and validate session
        if (sessionText) {
          const result = parseSessionText(sessionText);

          if (!result.ok) {
            if (!(await leave())) return;
            commit({
              session: {
                kind: 'refused',
                reason: result.reason.includes('version') ? 'unknown-version' : 'invalid-session',
                message: result.reason,
              },
            });
            return;
          }

          // Check fingerprint
          if (result.session.fingerprint !== meta.fingerprint) {
            if (!(await leave())) return;
            commit({
              session: {
                kind: 'refused',
                reason: 'fingerprint-mismatch',
                message: `Session fingerprint ${result.session.fingerprint} does not match source ${meta.fingerprint}`,
              },
            });
            return;
          }

          // Apply session
          const restored = stateFromSession(result.session);

          // If restored format differs from meta.format, regroup the index
          let regroupResult: GroupResult | null = null;
          if (!formatEquals(meta.format, restored.format) && source.kind === 'jsonl' && handle) {
            // A regroup that fails stops the switch cleanly, the new reader released,
            // and the failure goes to the caller, as a failed read does (D-076)
            try {
              regroupResult = await handle.regroup(restored.format);
            } catch (err) {
              abandon();
              throw err;
            }
            if (!ctx.current()) return abandon();
          }
          if (!(await leave())) return;
          if (regroupResult && source.kind === 'jsonl') {
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

          commit({
            format: restored.format,
            decisions: restored.decisions,
            mode: restoredMode,
            cursor: clampCursor(restored.cursor, total),
            past: restored.past,
            session: { kind: 'restored' },
            lastSavedAt: result.session.savedAt,
            // A migrated version-2 text is not what the next save writes (version 3)
            _lastSerializedText: result.migrated ? null : sessionText,
          });
          return;
        }

        // Fresh session - use format from meta (no regroup needed, already done by reader)
        if (!(await leave())) return;
        commit({});
      };

      await runSwitch(meta.sourceName, run, () => handle?.dispose(), true);
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
      // A regroup that fails changes nothing; it is reported in the switch notice
      // once the switch has ended, since the switch's end clears the notice (D-076)
      let failed: string | null = null;
      // Re-grouping changes the index under the cursor: one switch at a time (DR-001)
      await runSwitch(
        get().sourceName,
        async (ctx) => {
          const state = get();

          // No-op if format is unchanged
          if (formatEquals(state.format, format)) {
            return;
          }

          // Without a regroup the format is still a change, saved like any other (D-074)
          if (!state.source || state.source.kind !== 'jsonl') {
            // setFormat only applies to JSONL sources
            set({ format });
            scheduleStoreSave();
            return;
          }

          const handle = regroupHandles.get(state.fingerprint);
          if (!handle) {
            // No regroup handle - just update format
            set({ format });
            scheduleStoreSave();
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
          let result: GroupResult;
          try {
            result = await handle.regroup(format);
          } catch (err) {
            failed = `Re-grouping for the format failed: ${err instanceof Error ? err.message : String(err)}`;
            return;
          }
          if (!ctx.current()) return;

          // Copy the regroup result into the index before anything reads it
          // (the reader writes nothing into it, DR-001 rule 4)
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
        () => {}
      );
      if (failed !== null) set({ switchNotice: failed });
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
      // A download of this text clears the unsaved mark up to here (DR-001 refinement 1)
      priv.exportedChangeSeq = priv.changeSeq;

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
      const refuse = (opening: string) =>
        set({ session: { kind: 'refused', reason: 'switching', message: `Wait for ${opening} to open.` } });
      await runSwitch(opts?.name ?? 'the session', (ctx) => importBody(ctx, text, opts ?? {}), refuse);
    },

    async applyNewerLocalCopy() {
      if (!get().newerLocalCopy) return;
      // The import it makes runs inside the same switch (DR-001 refinement 3)
      await runSwitch(
        'the newer copy',
        async (ctx) => {
          // The text held since load, never IndexedDB again: a save since then
          // has overwritten the copy there (DR-001 amendment, D-075)
          const text = get()._newerLocalCopyText;
          if (!text) return;
          // importBody clears the offer when the import applies, and only then (D-059)
          await importBody(ctx, text, { force: true, name: 'the newer copy' });
        },
        () => {}
      );
    },

    beginOpening(name) {
      if (get().refuseWhileOpening()) return false;
      priv.switchReserved = true;
      set({ switching: { kind: 'opening', name }, switchNotice: null });
      return true;
    },

    endOpening() {
      // A reservation no switch claimed (the read failed) is dropped
      if (!priv.switchReserved || priv.switchRunning) return;
      priv.switchReserved = false;
      set({ switching: { kind: 'idle' }, switchNotice: null });
    },

    refuseWhileOpening() {
      const sw = get().switching;
      if (sw.kind !== 'opening') return false;
      noteRefusal(sw.name);
      return true;
    },

    async openAnywayDiscarding() {
      const held = priv.heldSwitch;
      if (!held) return;
      // Refused while a switch is opening: the request stays held (D-055, D-056)
      const sw = get().switching;
      if (sw.kind === 'opening') return noteRefusal(sw.name);
      // The held request and the actions that offer it in one set (D-068)
      set({ _heldSwitch: null, cancelledSwitch: null });
      await held.run();
    },

    noteSessionDownloaded() {
      markSinked(priv.exportedChangeSeq);
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
    if (makeFlushContext) saveImmediate(makeFlushContext(text), { keepalive, idbFirst: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const state = useReviewStore.getState();
      if (state.source && state._dirty) {
        // Flush pending save
        cancelPendingSaves();
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

        // The store's own save context: it clears the unsaved mark and keeps a
        // not-saved message (D-057); the page may be closing, so IndexedDB first (D-005 B)
        if (makeFlushContext) saveImmediate(makeFlushContext(text), { idbFirst: true });
      }
    }
  });
}
