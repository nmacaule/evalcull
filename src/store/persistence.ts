/**
 * Session persistence for WP 3.
 * Handles IndexedDB, sidecar transport, and session serialisation.
 */

import { wrap, type DBSchema, type IDBPDatabase } from 'idb';
import {
  parse as losslessParse,
  stringify as losslessStringify,
  isLosslessNumber,
} from 'lossless-json';
import type {
  CandidateRef,
  Decision,
  SessionState,
  HistoryAction,
  RecordFormat,
  DecisionStatus,
  Preference,
  CompareDecision,
} from '../types';
import { isValidRef, parseRefLine } from './refs';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SidecarTransport {
  get(): Promise<string | null>;
  put(
    text: string,
    // signal: aborted when the PUT times out, so a late request cannot land (D-040)
    opts?: { keepalive?: boolean; signal?: AbortSignal }
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }>;
}

interface EvalcullDB extends DBSchema {
  sessions: { key: string; value: string };
}

export interface ReviewStateForSerialization {
  source: { kind: 'jsonl' | 'rows' } | null;
  fingerprint: string;
  sourceName: string;
  format: RecordFormat;
  decisions: Map<CandidateRef, Decision>;
  cursor: number;
  past: HistoryAction[];
}

// -----------------------------------------------------------------------------
// Configuration seams
// -----------------------------------------------------------------------------

let configuredIndexedDB: IDBFactory | undefined =
  typeof indexedDB !== 'undefined' ? indexedDB : undefined;
let dbPromise: Promise<IDBPDatabase<EvalcullDB>> | null = null;

let sidecarToken: string | null = null;
let sidecarTransport: SidecarTransport | null = null;

/**
 * Configure storage layer. Tests call this with a fresh IDBFactory per test;
 * the absent test passes { indexedDB: undefined }.
 */
export function configureStorage(config: {
  indexedDB: IDBFactory | undefined;
}): void {
  configuredIndexedDB = config.indexedDB;
  dbPromise = null;
  // The latest copies recorded describe the previous factory's database (D-066)
  latestCopy.clear();
}

/**
 * Configure sidecar transport. Boot code (WP 9) calls this after GET /api/meta.
 * Pass null to clear the sidecar configuration.
 */
export function configureSidecar(config: {
  token: string;
  transport: SidecarTransport;
} | null): void {
  if (config === null) {
    sidecarToken = null;
    sidecarTransport = null;
  } else {
    sidecarToken = config.token;
    sidecarTransport = config.transport;
  }
}

/** Check if sidecar is configured. */
export function hasSidecar(): boolean {
  return sidecarToken !== null && sidecarTransport !== null;
}

/** Get the configured token (for transport implementations). */
export function getSidecarToken(): string | null {
  return sidecarToken;
}

// -----------------------------------------------------------------------------
// IndexedDB
// -----------------------------------------------------------------------------

function getDB(): Promise<IDBPDatabase<EvalcullDB>> | null {
  if (!configuredIndexedDB) return null;
  if (!dbPromise) {
    dbPromise = new Promise<IDBPDatabase<EvalcullDB>>((resolve, reject) => {
      const request = configuredIndexedDB!.open('evalcull', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('sessions');
      };
      request.onsuccess = () => {
        resolve(wrap(request.result) as IDBPDatabase<EvalcullDB>);
      };
      request.onerror = () => {
        reject(request.error);
      };
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function loadFromIndexedDB(
  fingerprint: string
): Promise<string | null> {
  const dbP = getDB();
  if (!dbP) return null;
  try {
    const db = await dbP;
    return (await db.get('sessions', fingerprint)) ?? null;
  } catch {
    return null;
  }
}

export async function saveToIndexedDB(
  fingerprint: string,
  text: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const dbP = getDB();
  if (!dbP) return { ok: false, reason: 'IndexedDB not available' };
  try {
    const db = await dbP;
    await db.put('sessions', text, fingerprint);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

// Session texts are numbered in the order they are taken; the number of the
// latest copy written at a file switch is kept per fingerprint, so a slower
// save still holding older text does not overwrite it when it finishes (D-036).
// A counter, not the clock: two texts can be taken in the same millisecond.
// The entry also holds that copy's own write, so a save that finds itself
// superseded writes its text after all when that write failed (D-053); the
// write is a direct IndexedDB call, never queued behind the save chain
let textSeq = 0;
const latestCopy = new Map<string, { seq: number; written: Promise<boolean> }>();

/** Write the session's latest text to IndexedDB at a file switch (D-036). */
export async function saveLatestToIndexedDB(
  fingerprint: string,
  text: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const seq = ++textSeq;
  const write = saveToIndexedDB(fingerprint, text);
  latestCopy.set(fingerprint, { seq, written: write.then((r) => r.ok) });
  return write;
}

// -----------------------------------------------------------------------------
// Number conversion for session parsing
// -----------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (isLosslessNumber(value)) return Number(value.value);
  throw new Error('Expected number');
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return toNumber(value);
}

// -----------------------------------------------------------------------------
// Session parsing
// -----------------------------------------------------------------------------

const VALID_STATUSES: DecisionStatus[] = [
  'unreviewed',
  'kept',
  'rejected',
  'skipped',
];
const VALID_PREFERENCES: Preference[] = ['left', 'right', 'tie', 'both_bad'];

function isValidStatus(s: unknown): s is DecisionStatus {
  return typeof s === 'string' && VALID_STATUSES.includes(s as DecisionStatus);
}

function isValidPreference(p: unknown): p is Preference {
  return typeof p === 'string' && VALID_PREFERENCES.includes(p as Preference);
}

function isValidStrength(s: unknown): s is 1 | 2 | 3 | undefined {
  return s === undefined || s === 1 || s === 2 || s === 3;
}

/**
 * Validate one decision's compare element (v2: the object; v3: each array element).
 * `where` names it in the reason, e.g. "0" or "0 compare[1]".
 */
function parseCompareDecision(
  value: unknown,
  where: string
): { ok: true; compare: CompareDecision } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: `Invalid compare in ${where}` };
  }
  const c = value as Record<string, unknown>;
  if (typeof c.left !== 'string' || !isValidRef(c.left)) {
    return { ok: false, reason: `Invalid compare.left in ${where}` };
  }
  if (typeof c.right !== 'string' || !isValidRef(c.right)) {
    return { ok: false, reason: `Invalid compare.right in ${where}` };
  }
  if (!isValidPreference(c.preference)) {
    return { ok: false, reason: `Invalid compare.preference in ${where}` };
  }
  let strength: 1 | 2 | 3 | undefined;
  try {
    const rawStrength = toNumberOrUndefined(c.strength);
    if (!isValidStrength(rawStrength)) {
      return { ok: false, reason: `Invalid compare.strength in ${where}` };
    }
    strength = rawStrength;
  } catch {
    return { ok: false, reason: `Invalid compare.strength in ${where}` };
  }
  return {
    ok: true,
    compare: {
      left: c.left as CandidateRef,
      right: c.right as CandidateRef,
      preference: c.preference as Preference,
      strength,
    },
  };
}

// Version-2 session shape (before PRD v3.3): one compare object, no history pair index.
type DecisionV2 = Omit<Decision, 'compare'> & { compare?: CompareDecision };
type HistoryActionV2 =
  | Exclude<HistoryAction, { type: 'compare' }>
  | { type: 'compare'; ref: CandidateRef; before?: CompareDecision; after?: CompareDecision };
interface SessionStateV2 extends Omit<SessionState, 'version' | 'decisions' | 'history'> {
  version: 2;
  decisions: Record<CandidateRef, DecisionV2>;
  history: HistoryActionV2[];
}

/**
 * v2 → v3: each compare object becomes a one-element array; each history compare
 * action gains pair: 0. Shape only: refs are not remapped.
 */
function migrateSessionV2(v2: SessionStateV2): SessionState {
  const decisions: Record<CandidateRef, Decision> = {};
  for (const [ref, d] of Object.entries(v2.decisions)) {
    const { compare, ...rest } = d;
    decisions[ref] = compare ? { ...rest, compare: [compare] } : rest;
  }
  const history: HistoryAction[] = v2.history.map((h) =>
    h.type === 'compare' ? { ...h, pair: 0 } : h
  );
  return { ...v2, version: 3, decisions, history };
}

export function parseSessionText(
  text: string
):
  | { ok: true; session: SessionState; migrated: boolean }
  | { ok: false; reason: string } {
  let raw: Record<string, unknown>;
  try {
    raw = losslessParse(text) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `JSON parse error: ${err}` };
  }

  // Version check: 3 is current; 2 is migrated (PRD v3.3); anything else is refused
  let version: number;
  try {
    version = toNumber(raw.version);
  } catch {
    return { ok: false, reason: 'Invalid version field' };
  }
  if (version !== 2 && version !== 3) {
    return { ok: false, reason: `Unknown version: ${version}` };
  }

  // Required fields
  if (typeof raw.fingerprint !== 'string') {
    return { ok: false, reason: 'Missing or invalid fingerprint' };
  }
  if (typeof raw.sourceName !== 'string') {
    return { ok: false, reason: 'Missing or invalid sourceName' };
  }
  if (raw.sourceKind !== 'jsonl' && raw.sourceKind !== 'rows') {
    return { ok: false, reason: 'Invalid sourceKind' };
  }
  if (!raw.format || typeof raw.format !== 'object') {
    return { ok: false, reason: 'Missing or invalid format' };
  }

  let cursor: number;
  let savedAt: number;
  try {
    cursor = toNumber(raw.cursor);
    savedAt = toNumber(raw.savedAt);
  } catch {
    return { ok: false, reason: 'Invalid cursor or savedAt' };
  }

  // Parse decisions with number conversion
  const rawDecisions = raw.decisions as Record<string, unknown> | undefined;
  if (!rawDecisions || typeof rawDecisions !== 'object') {
    return { ok: false, reason: 'Missing or invalid decisions' };
  }

  const decisions: Record<CandidateRef, DecisionV2 | Decision> = {};
  for (const [ref, d] of Object.entries(rawDecisions)) {
    if (!isValidRef(ref)) {
      return { ok: false, reason: `Invalid decision ref: ${ref}` };
    }
    const dec = d as Record<string, unknown>;
    if (!isValidStatus(dec.status)) {
      return { ok: false, reason: `Invalid status in decision ${ref}` };
    }

    let updatedAt: number;
    let score: number | undefined;
    try {
      updatedAt = toNumber(dec.updatedAt);
      score = toNumberOrUndefined(dec.score);
    } catch {
      return { ok: false, reason: `Invalid numeric field in decision ${ref}` };
    }

    const base: Omit<Decision, 'compare'> = {
      status: dec.status as DecisionStatus,
      updatedAt,
      score,
      labels: dec.labels as string[] | undefined,
      notes: dec.notes as string | undefined,
      edits: dec.edits as Record<string, unknown> | undefined,
    };

    if (dec.compare === undefined) {
      decisions[ref] = base;
    } else if (version === 2) {
      // v2: one compare object per prompt
      const parsed = parseCompareDecision(dec.compare, ref);
      if (!parsed.ok) return parsed;
      decisions[ref] = { ...base, compare: parsed.compare };
    } else {
      // v3: one compare element per judged pair, never empty
      if (!Array.isArray(dec.compare) || dec.compare.length === 0) {
        return { ok: false, reason: `Invalid compare in ${ref}: expected a non-empty array` };
      }
      const compare: CompareDecision[] = [];
      for (let j = 0; j < dec.compare.length; j++) {
        const parsed = parseCompareDecision(dec.compare[j], `${ref} compare[${j}]`);
        if (!parsed.ok) return parsed;
        compare.push(parsed.compare);
      }
      decisions[ref] = { ...base, compare };
    }
  }

  // Parse history with number conversion
  const rawHistory = raw.history as unknown[] | undefined;
  if (!Array.isArray(rawHistory)) {
    return { ok: false, reason: 'Missing or invalid history' };
  }

  const history: Array<HistoryActionV2 | HistoryAction> = [];
  for (let i = 0; i < rawHistory.length; i++) {
    const h = rawHistory[i] as Record<string, unknown>;
    const actionType = h.type as string;

    if (typeof h.ref !== 'string' || !isValidRef(h.ref)) {
      return { ok: false, reason: `Invalid ref in history[${i}]` };
    }

    if (actionType === 'status') {
      if (!isValidStatus(h.before) || !isValidStatus(h.after)) {
        return { ok: false, reason: `Invalid status in history[${i}]` };
      }
      history.push({
        type: 'status',
        ref: h.ref as CandidateRef,
        before: h.before as DecisionStatus,
        after: h.after as DecisionStatus,
      });
    } else if (actionType === 'compare') {
      // Convert strength in before/after
      const before = h.before as Record<string, unknown> | undefined;
      const after = h.after as Record<string, unknown> | undefined;

      let convertedBefore: CompareDecision | undefined;
      let convertedAfter: CompareDecision | undefined;

      if (before !== undefined) {
        try {
          const strength = toNumberOrUndefined(before.strength);
          if (!isValidStrength(strength)) {
            return {
              ok: false,
              reason: `Invalid strength in history[${i}].before`,
            };
          }
          convertedBefore = {
            left: before.left as CandidateRef,
            right: before.right as CandidateRef,
            preference: before.preference as Preference,
            strength,
          };
        } catch {
          return {
            ok: false,
            reason: `Invalid numeric in history[${i}].before`,
          };
        }
      }

      if (after !== undefined) {
        try {
          const strength = toNumberOrUndefined(after.strength);
          if (!isValidStrength(strength)) {
            return {
              ok: false,
              reason: `Invalid strength in history[${i}].after`,
            };
          }
          convertedAfter = {
            left: after.left as CandidateRef,
            right: after.right as CandidateRef,
            preference: after.preference as Preference,
            strength,
          };
        } catch {
          return {
            ok: false,
            reason: `Invalid numeric in history[${i}].after`,
          };
        }
      }

      if (version === 2) {
        history.push({
          type: 'compare',
          ref: h.ref as CandidateRef,
          before: convertedBefore,
          after: convertedAfter,
        });
      } else {
        // v3: pair indexes into the prompt's compare[]
        let pair: number;
        try {
          pair = toNumber(h.pair);
        } catch {
          return { ok: false, reason: `Invalid pair in history[${i}]` };
        }
        if (!Number.isInteger(pair) || pair < 0) {
          return { ok: false, reason: `Invalid pair in history[${i}]` };
        }
        history.push({
          type: 'compare',
          ref: h.ref as CandidateRef,
          pair,
          before: convertedBefore,
          after: convertedAfter,
        });
      }
    } else if (actionType === 'edit') {
      // before/after untouched - may contain LosslessNumber
      history.push({
        type: 'edit',
        ref: h.ref as CandidateRef,
        path: h.path as string,
        before: h.before,
        after: h.after,
      });
    } else if (actionType === 'labels') {
      history.push({
        type: 'labels',
        ref: h.ref as CandidateRef,
        before: h.before as string[],
        after: h.after as string[],
      });
    } else if (actionType === 'score') {
      // Convert before/after to numbers
      let before: number | undefined;
      let after: number | undefined;
      try {
        before = toNumberOrUndefined(h.before);
        after = toNumberOrUndefined(h.after);
      } catch {
        return { ok: false, reason: `Invalid score in history[${i}]` };
      }
      history.push({
        type: 'score',
        ref: h.ref as CandidateRef,
        before,
        after,
      });
    } else if (actionType === 'notes') {
      history.push({
        type: 'notes',
        ref: h.ref as CandidateRef,
        before: h.before as string | undefined,
        after: h.after as string | undefined,
      });
    } else {
      return { ok: false, reason: `Unknown history action type: ${actionType}` };
    }
  }

  const common = {
    fingerprint: raw.fingerprint as string,
    sourceName: raw.sourceName as string,
    sourceKind: raw.sourceKind as 'jsonl' | 'rows',
    format: raw.format as RecordFormat,
    cursor,
    savedAt,
  };

  if (version === 2) {
    const v2: SessionStateV2 = {
      ...common,
      version: 2,
      decisions: decisions as Record<CandidateRef, DecisionV2>,
      history: history as HistoryActionV2[],
    };
    return { ok: true, session: migrateSessionV2(v2), migrated: true };
  }

  return {
    ok: true,
    session: {
      ...common,
      version: 3,
      decisions: decisions as Record<CandidateRef, Decision>,
      history: history as HistoryAction[],
    },
    migrated: false,
  };
}

// -----------------------------------------------------------------------------
// Session serialisation
// -----------------------------------------------------------------------------

/**
 * Sort decisions for deterministic serialisation.
 * Object enumeration order puts integer-like keys in numeric order first,
 * so the text reads prompt refs then candidates. Fixture written in enumerated order.
 */
function sortDecisionKeys(
  decisions: Map<CandidateRef, Decision>
): [CandidateRef, Decision][] {
  const entries = [...decisions.entries()];
  return entries.sort(([a], [b]) => {
    const aLine = parseRefLine(a);
    const bLine = parseRefLine(b);
    if (aLine !== bLine) return aLine - bLine;

    const aIsPrompt = a.indexOf(':') === -1;
    const bIsPrompt = b.indexOf(':') === -1;
    if (aIsPrompt && !bIsPrompt) return -1;
    if (!aIsPrompt && bIsPrompt) return 1;
    if (aIsPrompt && bIsPrompt) return 0;

    const aCand = parseInt(a.slice(a.indexOf(':') + 1), 10);
    const bCand = parseInt(b.slice(b.indexOf(':') + 1), 10);
    return aCand - bCand;
  });
}

/**
 * Serialise state to session JSON text.
 * Deterministic for injected clock; 2-space indent + trailing LF.
 * Decisions sorted canonically for git-friendly diffs.
 */
export function serialiseSession(
  state: ReviewStateForSerialization,
  now: () => number
): string {
  if (!state.source) {
    throw new Error('Cannot serialise: no source loaded');
  }

  const sortedDecisions = sortDecisionKeys(state.decisions);
  const decisionsObj: Record<CandidateRef, Decision> = {};
  for (const [ref, d] of sortedDecisions) {
    decisionsObj[ref] = d;
  }

  const session: SessionState = {
    version: 3,
    fingerprint: state.fingerprint,
    sourceName: state.sourceName,
    sourceKind: state.source.kind,
    format: state.format,
    decisions: decisionsObj,
    cursor: state.cursor,
    history: [...state.past],
    savedAt: now(),
  };

  return losslessStringify(session, undefined, 2) + '\n';
}

/**
 * Reconstruct partial state fields from a parsed SessionState.
 * Used by load() and importSession().
 */
export function stateFromSession(session: SessionState): {
  fingerprint: string;
  sourceName: string;
  format: RecordFormat;
  decisions: Map<CandidateRef, Decision>;
  cursor: number;
  past: HistoryAction[];
} {
  return {
    fingerprint: session.fingerprint,
    sourceName: session.sourceName,
    format: session.format,
    decisions: new Map(Object.entries(session.decisions)),
    cursor: session.cursor,
    past: session.history,
  };
}

// -----------------------------------------------------------------------------
// Save queue: one write in flight, latest state wins
// -----------------------------------------------------------------------------

let saveGeneration = 0;
let pendingSaveTimeout: ReturnType<typeof setTimeout> | null = null;

// One-in-flight chain: only one executeSave runs at a time.
// Changes during a write set dirtyDuringWrite; when the write settles,
// exactly one follow-up write runs with the latest state.
let saveInFlight: Promise<void> | null = null;
let dirtyDuringWrite = false;
let pendingCtx: SaveContext | null = null;
// The options of the latest caller while a write is in flight, so a pagehide
// follow-up keeps its keepalive (D-005 F)
let pendingOpts: SaveOptions | undefined;

export interface SaveOptions {
  /** fetch keepalive for the sidecar PUT (pagehide) */
  keepalive?: boolean;
  /** Start the IndexedDB write before the sidecar PUT (page lifecycle flushes, D-005 B) */
  idbFirst?: boolean;
}

// Told whenever "a save is pending or in flight" changes (D-005 G)
let savePendingListener: ((pending: boolean) => void) | null = null;
let lastNotifiedPending = false;

export function onSavePendingChange(listener: ((pending: boolean) => void) | null): void {
  savePendingListener = listener;
}

function notifySavePending(): void {
  const pending = pendingSaveTimeout !== null || saveInFlight !== null;
  if (pending === lastNotifiedPending) return;
  lastNotifiedPending = pending;
  savePendingListener?.(pending);
}

const DEBOUNCE_MS = 500;
// A sidecar PUT that has not answered by then counts as failed, so one hung
// request cannot hold the one-in-flight chain forever (D-035, PRD §2.7)
const SIDECAR_PUT_TIMEOUT_MS = 10_000;
// A run of changes closer together than the debounce still saves this soon
// after the first of them (WP 3 decision f, D-010)
const MAX_WAIT_MS = 2000;
// When the oldest change not yet handed to a save was made; null when none is pending
let pendingSince: number | null = null;
// The context of the debounced save, so a flush can run it at once (D-029)
let scheduledCtx: SaveContext | null = null;

function clearPendingSaves(): void {
  if (pendingSaveTimeout) {
    clearTimeout(pendingSaveTimeout);
    pendingSaveTimeout = null;
  }
  pendingSince = null;
  scheduledCtx = null;
  // Clear pending follow-up but don't abort in-flight write
  dirtyDuringWrite = false;
  pendingCtx = null;
  pendingOpts = undefined;
}

export function cancelPendingSaves(): void {
  clearPendingSaves();
  notifySavePending();
}

export function bumpSaveGeneration(): number {
  cancelPendingSaves();
  return ++saveGeneration;
}

export function getCurrentGeneration(): number {
  return saveGeneration;
}

export interface SaveContext {
  generation: number;
  fingerprint: string;
  getText: () => string;
  onSaved: (savedAt: number) => void;
  onError: (reason: string) => void;
  onIDBUnavailable: (reason: string) => void;
  /** This save's text reached the sidecar or IndexedDB (DR-001 rule 3) */
  onPersisted?: () => void;
}

/**
 * Core save logic. Order: serialize once, PUT to sidecar if configured,
 * write IndexedDB. Outcome: sidecar ok → saved, else IDB ok → saved,
 * else IDB unavailable → 'unavailable', else 'error'.
 */
async function executeSave(
  ctx: SaveContext,
  opts?: SaveOptions
): Promise<void> {
  if (ctx.generation !== saveGeneration) return;

  // Serialize once (reads latest state)
  const text = ctx.getText();
  const seq = ++textSeq;
  const savedAt = Date.now();

  // On page close the PUT may be cut off, so the local write starts first (D-005 B)
  const idbFirst = opts?.idbFirst ? saveToIndexedDB(ctx.fingerprint, text) : null;

  // PUT to sidecar if configured (authoritative)
  let sidecarResult: { ok: true } | { ok: false; status: number; message: string } | null = null;
  let sidecarTimedOut = false;
  if (sidecarTransport) {
    // The timeout also aborts the request, so a PUT that lands late cannot
    // leave the sidecar older than a later save (D-040)
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve(null);
      }, SIDECAR_PUT_TIMEOUT_MS);
    });
    const answer = await Promise.race([
      sidecarTransport.put(text, { keepalive: opts?.keepalive, signal: abort.signal }),
      timeout,
    ]);
    clearTimeout(timer);
    if (answer === null) sidecarTimedOut = true;
    else sidecarResult = answer;
  }

  // Write to IndexedDB (best-effort). The text and fingerprint are this save's
  // own, so the write completes even if another file has loaded since; the
  // generation check guards only the store updates below (D-029). A newer copy
  // written at a file switch is not overwritten with this older text (D-036),
  // unless that copy's own write failed (D-053)
  const latest = latestCopy.get(ctx.fingerprint);
  const idbResult = await (idbFirst ??
    (latest && latest.seq > seq
      ? latest.written.then((ok) => (ok ? { ok: true as const } : saveToIndexedDB(ctx.fingerprint, text)))
      : saveToIndexedDB(ctx.fingerprint, text)));
  if (ctx.generation !== saveGeneration) return;
  if (sidecarResult?.ok || idbResult.ok) ctx.onPersisted?.();

  // Determine outcome: sidecar ok → saved, else IDB ok → saved,
  // else IDB unavailable → 'unavailable', else 'error'
  if (sidecarTimedOut) {
    ctx.onError('Sidecar PUT timed out after 10 s');
  } else if (sidecarResult?.ok) {
    ctx.onSaved(savedAt);
  } else if (sidecarResult && !sidecarResult.ok) {
    ctx.onError(`Sidecar PUT failed: ${sidecarResult.status} ${sidecarResult.message}`);
  } else if (idbResult.ok) {
    ctx.onSaved(savedAt);
  } else if (idbResult.reason === 'IndexedDB not available') {
    ctx.onIDBUnavailable(idbResult.reason);
  } else {
    ctx.onError(idbResult.reason);
  }
}

/**
 * Start or chain a save. Ensures one write in flight at a time.
 * If a write is in flight, marks dirty so a follow-up runs when it settles.
 */
function startOrChainSave(ctx: SaveContext, opts?: SaveOptions): void {
  if (saveInFlight) {
    // Write in flight: mark dirty, store latest context and its options
    dirtyDuringWrite = true;
    pendingCtx = ctx;
    pendingOpts = opts;
    return;
  }

  // Start the save chain
  saveInFlight = (async () => {
    await executeSave(ctx, opts);

    // Chain: if dirty during this write, run exactly one follow-up
    while (dirtyDuringWrite && pendingCtx) {
      const nextCtx = pendingCtx;
      const nextOpts = pendingOpts;
      dirtyDuringWrite = false;
      pendingCtx = null;
      pendingOpts = undefined;
      await executeSave(nextCtx, nextOpts);
    }

    saveInFlight = null;
    notifySavePending();
  })();
  notifySavePending();
}

export function scheduleSave(ctx: SaveContext): void {
  const now = Date.now();
  const since = pendingSince ?? now;
  clearPendingSaves();
  pendingSince = since;

  // Debounce, but never later than MAX_WAIT_MS after the first pending change
  const delay = Math.min(DEBOUNCE_MS, Math.max(0, since + MAX_WAIT_MS - now));
  scheduledCtx = ctx;
  pendingSaveTimeout = setTimeout(() => {
    pendingSaveTimeout = null;
    pendingSince = null;
    scheduledCtx = null;
    startOrChainSave(ctx);
  }, delay);
  notifySavePending();
}

/** Whether a save is scheduled or in flight, so a caller awaits a flush only when there is one. */
export function isSavePending(): boolean {
  return pendingSaveTimeout !== null || saveInFlight !== null;
}

/** How long opening another file waits for the current file's save (PRD §2.7, D-034). */
export const FLUSH_MAX_WAIT_MS = 5000;

/**
 * Run a debounced save now instead of dropping it, and wait for the chain to
 * settle, so opening another file or loading a session saves the current
 * file's pending changes first (D-029; PRD §2.7). The save starts its
 * IndexedDB write before the sidecar PUT, as the page-close flushes do, and
 * the wait ends after maxWaitMs even if the PUT never answers (D-034); the
 * save itself keeps running. Resolves true when the chain settled in time.
 */
export async function flushPendingSave(maxWaitMs: number = FLUSH_MAX_WAIT_MS): Promise<boolean> {
  const ctx = scheduledCtx;
  if (pendingSaveTimeout && ctx) {
    clearPendingSaves();
    startOrChainSave(ctx, { idbFirst: true });
  }
  if (!saveInFlight) return true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, maxWaitMs));
  });
  const settled = (async () => {
    while (saveInFlight) await saveInFlight;
    return true as const;
  })();
  const result = await Promise.race([settled, timedOut]);
  clearTimeout(timer);
  return result;
}

export async function saveImmediate(
  ctx: SaveContext,
  opts?: SaveOptions
): Promise<void> {
  clearPendingSaves();
  startOrChainSave(ctx, opts);
  // Wait for the chain to complete
  if (saveInFlight) {
    await saveInFlight;
  }
}

// -----------------------------------------------------------------------------
// Load from sidecar
// -----------------------------------------------------------------------------

export async function loadFromSidecar(): Promise<string | null> {
  if (!sidecarTransport) return null;
  return sidecarTransport.get();
}

/**
 * The format of the session load() would restore for this fingerprint, so the
 * reader can group for it once instead of detecting and then regrouping (D-004).
 * Same source order as load(): the sidecar when configured, else IndexedDB.
 * Null when there is none, or it would be refused.
 */
export async function loadStoredFormat(fingerprint: string): Promise<RecordFormat | null> {
  const text = (hasSidecar() ? await loadFromSidecar() : null) ?? (await loadFromIndexedDB(fingerprint));
  if (!text) return null;
  const result = parseSessionText(text);
  if (!result.ok || result.session.fingerprint !== fingerprint) return null;
  return result.session.format;
}

// -----------------------------------------------------------------------------
// Production fetch transport
// -----------------------------------------------------------------------------

/**
 * Create a SidecarTransport that uses fetch to talk to the sidecar server.
 * The launcher serves the page, so paths are same-origin and relative by default.
 * GET is Host-check only (§2.9); PUT requires the token.
 */
export function makeFetchTransport(
  baseUrl: string = '',
  fetchFn: typeof fetch = fetch
): SidecarTransport {
  return {
    async get(): Promise<string | null> {
      // GET /api/session is Host-check only, no token required (§2.9)
      try {
        const response = await fetchFn(`${baseUrl}/api/session`, {
          method: 'GET',
        });

        if (response.status === 404) return null;
        if (!response.ok) return null;

        return await response.text();
      } catch {
        return null;
      }
    },

    async put(
      text: string,
      opts?: { keepalive?: boolean; signal?: AbortSignal }
    ): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
      const token = getSidecarToken();
      if (!token) return { ok: false, status: 0, message: 'No token configured' };

      try {
        const response = await fetchFn(`${baseUrl}/api/session`, {
          method: 'PUT',
          headers: {
            'X-Evalcull-Token': token,
            'Content-Type': 'application/json',
          },
          body: text,
          keepalive: opts?.keepalive,
          signal: opts?.signal,
        });

        if (response.ok) {
          return { ok: true };
        }

        return {
          ok: false,
          status: response.status,
          message: response.statusText,
        };
      } catch (err) {
        return { ok: false, status: 0, message: String(err) };
      }
    },
  };
}
