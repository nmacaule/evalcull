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
    opts?: { keepalive?: boolean }
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

export function parseSessionText(
  text: string
): { ok: true; session: SessionState } | { ok: false; reason: string } {
  let raw: Record<string, unknown>;
  try {
    raw = losslessParse(text) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `JSON parse error: ${err}` };
  }

  // Version check
  let version: number;
  try {
    version = toNumber(raw.version);
  } catch {
    return { ok: false, reason: 'Invalid version field' };
  }
  if (version !== 2) {
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

  const decisions: Record<CandidateRef, Decision> = {};
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

    const decision: Decision = {
      status: dec.status as DecisionStatus,
      updatedAt,
      score,
      labels: dec.labels as string[] | undefined,
      notes: dec.notes as string | undefined,
      edits: dec.edits as Record<string, unknown> | undefined,
    };

    // Validate compare if present
    if (dec.compare !== undefined) {
      const c = dec.compare as Record<string, unknown>;
      if (typeof c.left !== 'string' || !isValidRef(c.left)) {
        return { ok: false, reason: `Invalid compare.left in ${ref}` };
      }
      if (typeof c.right !== 'string' || !isValidRef(c.right)) {
        return { ok: false, reason: `Invalid compare.right in ${ref}` };
      }
      if (!isValidPreference(c.preference)) {
        return { ok: false, reason: `Invalid compare.preference in ${ref}` };
      }
      let strength: 1 | 2 | 3 | undefined;
      try {
        const rawStrength = toNumberOrUndefined(c.strength);
        if (!isValidStrength(rawStrength)) {
          return { ok: false, reason: `Invalid compare.strength in ${ref}` };
        }
        strength = rawStrength;
      } catch {
        return { ok: false, reason: `Invalid compare.strength in ${ref}` };
      }

      decision.compare = {
        left: c.left as CandidateRef,
        right: c.right as CandidateRef,
        preference: c.preference as Preference,
        strength,
      };
    }

    decisions[ref] = decision;
  }

  // Parse history with number conversion
  const rawHistory = raw.history as unknown[] | undefined;
  if (!Array.isArray(rawHistory)) {
    return { ok: false, reason: 'Missing or invalid history' };
  }

  const history: HistoryAction[] = [];
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

      history.push({
        type: 'compare',
        ref: h.ref as CandidateRef,
        before: convertedBefore,
        after: convertedAfter,
      });
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

  return {
    ok: true,
    session: {
      version: 2,
      fingerprint: raw.fingerprint as string,
      sourceName: raw.sourceName as string,
      sourceKind: raw.sourceKind as 'jsonl' | 'rows',
      format: raw.format as RecordFormat,
      decisions,
      cursor,
      history,
      savedAt,
    },
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
    version: 2,
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

const DEBOUNCE_MS = 500;

export function cancelPendingSaves(): void {
  if (pendingSaveTimeout) {
    clearTimeout(pendingSaveTimeout);
    pendingSaveTimeout = null;
  }
  // Clear pending follow-up but don't abort in-flight write
  dirtyDuringWrite = false;
  pendingCtx = null;
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
}

/**
 * Core save logic. Order: serialize once, PUT to sidecar if configured,
 * write IndexedDB. Outcome: sidecar ok → saved, else IDB ok → saved,
 * else IDB unavailable → 'unavailable', else 'error'.
 */
async function executeSave(
  ctx: SaveContext,
  opts?: { keepalive?: boolean }
): Promise<void> {
  if (ctx.generation !== saveGeneration) return;

  // Serialize once (reads latest state)
  const text = ctx.getText();
  const savedAt = Date.now();

  // PUT to sidecar if configured (authoritative)
  let sidecarResult: { ok: true } | { ok: false; status: number; message: string } | null = null;
  if (sidecarTransport) {
    sidecarResult = await sidecarTransport.put(text, opts);
    if (ctx.generation !== saveGeneration) return;
  }

  // Write to IndexedDB (best-effort)
  const idbResult = await saveToIndexedDB(ctx.fingerprint, text);
  if (ctx.generation !== saveGeneration) return;

  // Determine outcome: sidecar ok → saved, else IDB ok → saved,
  // else IDB unavailable → 'unavailable', else 'error'
  if (sidecarResult?.ok) {
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
function startOrChainSave(ctx: SaveContext, opts?: { keepalive?: boolean }): void {
  if (saveInFlight) {
    // Write in flight: mark dirty, store latest context
    dirtyDuringWrite = true;
    pendingCtx = ctx;
    return;
  }

  // Start the save chain
  saveInFlight = (async () => {
    await executeSave(ctx, opts);

    // Chain: if dirty during this write, run exactly one follow-up
    while (dirtyDuringWrite && pendingCtx) {
      const nextCtx = pendingCtx;
      dirtyDuringWrite = false;
      pendingCtx = null;
      await executeSave(nextCtx, opts);
    }

    saveInFlight = null;
  })();
}

export function scheduleSave(ctx: SaveContext): void {
  cancelPendingSaves();

  pendingSaveTimeout = setTimeout(() => {
    pendingSaveTimeout = null;
    startOrChainSave(ctx);
  }, DEBOUNCE_MS);
}

export async function saveImmediate(
  ctx: SaveContext,
  opts?: { keepalive?: boolean }
): Promise<void> {
  cancelPendingSaves();
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
      opts?: { keepalive?: boolean }
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
