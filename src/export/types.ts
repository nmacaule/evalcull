/**
 * Export types for WP 4.
 */

import type { RecordSource, RecordFormat, CandidateRef, Decision } from '../types';
import type { ParsedRecord } from '../store/types';

/**
 * Allowlist of export names from §3.7.
 */
export type ExportName =
  | 'pairs.jsonl'
  | 'pairs.edits.jsonl'
  | 'pairs.vertex.jsonl'
  | 'kept.jsonl'
  | 'rejected.jsonl'
  | 'skipped.jsonl'
  | 'all.decisions.jsonl';

/**
 * Context for buildExport.
 */
export interface BuildExportContext {
  source: RecordSource;
  decisions: Map<CandidateRef, Decision>;
  format: RecordFormat;
  record: (i: number) => Promise<ParsedRecord>;
  opts?: {
    bom?: 'keep' | 'strip' | 'add';
    excludeUnparseable?: boolean;
  };
}

/**
 * Result from buildExport.
 */
export interface BuildExportResult {
  blob: Blob;
  stats: ExportStats;
}

/**
 * Export statistics.
 * Preview stats computed from decisions/format/index only.
 * Exact stats gathered during buildExport.
 */
export interface ExportStats {
  name: ExportName;
  byteExact: boolean;
  lineCount: number;
  pairsCount: number;
  editPairsCount: number;
  tiesExcluded: number;
  bothBadExcluded: number;
  implicitPromptCount: number;
  editsExported: number;
  unparseableExcluded: number;
  skippedUnparseable: number;
}
