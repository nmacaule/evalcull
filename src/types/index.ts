export type DecisionStatus = 'unreviewed' | 'kept' | 'rejected' | 'skipped';

export type Preference = 'left' | 'right' | 'tie' | 'both_bad';

/** Where records come from. JSONL is byte-indexed; everything else is row-materialised. */
export type RecordSource =
  | {
      kind: 'jsonl';
      index: FileIndex;
      readText(i: number): Promise<string>;
      readRaw(i: number): Promise<Blob>;
    }
  | {
      kind: 'rows';
      container: 'json' | 'csv' | 'parquet' | 'inspect-eval' | 'promptfoo';
      count: number;
      readRow(i: number): Promise<unknown>;
    };

export interface FileIndex {
  fingerprint: string; // sha-256 of `${name}:${size}:${lastModified}`
  lineCount: number;
  starts: Float64Array;
  ends: Float64Array;
  eols: Uint8Array;
  hasBom: boolean;
  groups: Uint32Array;
  groupCount: number;
  unparseable: Uint32Array; // ascending line indices that fail to parse; added 2 Nov 2026
}

export type RecordFormat =
  | { kind: 'flat'; promptPath: string; responsePath: string }
  | {
      kind: 'messages';
      path: string;
      roleKey: string;
      contentKey: string;
      roles: { user: string[]; assistant: string[]; system: string[] };
    }
  | { kind: 'preference'; promptPath?: string; chosenPath: string; rejectedPath: string }
  | { kind: 'candidates'; promptPath: string; candidatesPath: string }
  | { kind: 'unknown' };

/** A candidate is one response to a prompt: `${record}` or `${record}:${candidate}`. */
export type CandidateRef = string;

export interface CompareDecision {
  left: CandidateRef;
  right: CandidateRef;
  preference: Preference;
  strength?: 1 | 2 | 3;
}

/** Sparse: only touched candidates/prompts have entries. */
export interface Decision {
  status: DecisionStatus;
  compare?: CompareDecision;
  labels?: string[];
  score?: number;
  notes?: string;
  edits?: Record<string, unknown>; // normalised JSON path -> replacement
  updatedAt: number;
}

export type HistoryAction =
  | { type: 'status'; ref: CandidateRef; before: DecisionStatus; after: DecisionStatus }
  | { type: 'compare'; ref: CandidateRef; before?: CompareDecision; after?: CompareDecision }
  | { type: 'edit'; ref: CandidateRef; path: string; before: unknown; after: unknown }
  | { type: 'labels'; ref: CandidateRef; before: string[]; after: string[] }
  | { type: 'score'; ref: CandidateRef; before?: number; after?: number }
  | { type: 'notes'; ref: CandidateRef; before?: string; after?: string };

export interface SessionState {
  version: 2;
  fingerprint: string;
  sourceName: string;
  sourceKind: RecordSource['kind'];
  format: RecordFormat;
  decisions: Record<CandidateRef, Decision>;
  cursor: number;
  history: HistoryAction[];
  savedAt: number;
}
