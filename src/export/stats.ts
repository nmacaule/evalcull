/**
 * Compute export statistics (preview, without reading records).
 */

import type { RecordSource, RecordFormat, CandidateRef, Decision } from '../types';
import type { ExportName, ExportStats } from './types';
import { groupByLine, lineDecision } from '../store/refs';

/**
 * Compute preview statistics for an export.
 * Derived from decisions/format/index only, no record access.
 */
export function computeExportStats(
  name: ExportName,
  src: RecordSource,
  decisions: Map<CandidateRef, Decision>,
  format: RecordFormat,
  opts: { excludeUnparseable?: boolean } = {}
): ExportStats {
  const total = src.kind === 'jsonl' ? src.index.lineCount : src.count;
  const byLineIndex = groupByLine(decisions);

  // Determine if byte-exact based on export name and source
  const byteExactNames = new Set(['kept.jsonl', 'rejected.jsonl', 'skipped.jsonl']);
  const byteExact = byteExactNames.has(name) && src.kind === 'jsonl';

  // Count lines for kept/rejected/skipped
  let lineCount = 0;
  let editsExported = 0;
  let unparseableExcluded = 0;

  // Get unparseable set for JSONL
  const unparseableSet = new Set<number>();
  if (src.kind === 'jsonl') {
    for (const idx of src.index.unparseable) {
      unparseableSet.add(idx);
    }
  }

  if (name === 'kept.jsonl' || name === 'rejected.jsonl' || name === 'skipped.jsonl') {
    const targetStatus = name.replace('.jsonl', '') as 'kept' | 'rejected' | 'skipped';

    for (let i = 0; i < total; i++) {
      const d = lineDecision(decisions, byLineIndex, i);

      if (opts.excludeUnparseable && unparseableSet.has(i)) {
        unparseableExcluded++;
        continue;
      }

      if (d?.status === targetStatus) {
        lineCount++;
        if (d.edits && Object.keys(d.edits).length > 0) {
          editsExported++;
        }
      }
    }
  } else if (name === 'all.decisions.jsonl') {
    lineCount = total;
    if (opts.excludeUnparseable) {
      unparseableExcluded = unparseableSet.size;
      lineCount -= unparseableExcluded;
    }

    // Count edits
    for (const d of decisions.values()) {
      if (d.edits && Object.keys(d.edits).length > 0) {
        editsExported++;
      }
    }
  }

  // Count pairs from compare decisions
  let pairsCount = 0;
  let tiesExcluded = 0;
  let bothBadExcluded = 0;
  let implicitPromptCount = 0;

  if (name === 'pairs.jsonl') {
    // One count per judged pair (v3.3)
    for (const [, decision] of decisions) {
      for (const compare of decision.compare ?? []) {
        if (compare.preference === 'tie') {
          tiesExcluded++;
        } else if (compare.preference === 'both_bad') {
          bothBadExcluded++;
        } else {
          pairsCount++;
        }
      }
    }

    // Estimate implicit prompt count for preference format without promptPath
    if (format.kind === 'preference' && !format.promptPath) {
      implicitPromptCount = pairsCount;
    }
  }

  // Count edit pairs
  let editPairsCount = 0;
  if (name === 'pairs.edits.jsonl') {
    for (const [, decision] of decisions) {
      if (decision.edits && Object.keys(decision.edits).length > 0) {
        editPairsCount++;
      }
    }
  }

  return {
    name,
    byteExact,
    lineCount,
    pairsCount,
    editPairsCount,
    tiesExcluded,
    bothBadExcluded,
    implicitPromptCount,
    editsExported,
    unparseableExcluded,
    skippedUnparseable: 0, // Only known after buildExport runs
  };
}
