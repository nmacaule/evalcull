/**
 * Single entry point for all exports.
 * Dispatches to appropriate builder based on export name.
 */

import type { ExportName, BuildExportContext, BuildExportResult, ExportStats } from './types';
import { exportLines } from './exportLines';
import { exportRows } from './exportRows';
import { exportAllDecisions } from './exportAllDecisions';
import { exportPairsJsonl } from './exportPairs';
import { buildPairs } from '../lib/pairs';
import { lineDecision, parseRefLine } from '../store/refs';

const YIELD_INTERVAL = 5000;

/**
 * Build an export by name.
 *
 * @param name Export name from the allowlist
 * @param ctx Export context with source, decisions, format, record function
 * @param onProgress Optional progress callback
 * @returns Blob and exact stats gathered during build
 */
export async function buildExport(
  name: ExportName,
  ctx: BuildExportContext,
  onProgress?: (done: number, total: number) => void
): Promise<BuildExportResult> {
  const { source, decisions, format, record, opts = {} } = ctx;
  const bom = opts.bom ?? 'keep';
  const excludeUnparseable = opts.excludeUnparseable ?? false;

  // Get unparseable set for JSONL
  const unparseableSet = new Set<number>();
  if (source.kind === 'jsonl') {
    for (const idx of source.index.unparseable) {
      unparseableSet.add(idx);
    }
  }

  const isUnparseable = (i: number) => unparseableSet.has(i);

  // Build stats as we go
  const stats: ExportStats = {
    name,
    byteExact: false,
    lineCount: 0,
    pairsCount: 0,
    editPairsCount: 0,
    tiesExcluded: 0,
    bothBadExcluded: 0,
    implicitPromptCount: 0,
    editsExported: 0,
    unparseableExcluded: 0,
    skippedUnparseable: 0,
  };

  let blob: Blob;

  switch (name) {
    case 'pairs.vertex.jsonl':
      throw new Error('pairs.vertex.jsonl not implemented until WP 12');

    case 'pairs.jsonl':
    case 'pairs.edits.jsonl': {
      // Pre-fetch the prompt line and every candidate line of each compare
      // decision (candidates live on their own lines, v3.3), and edited lines
      const refsToFetch = new Set<number>();

      for (const [ref, decision] of decisions) {
        if (decision.compare?.length || (decision.edits && Object.keys(decision.edits).length > 0)) {
          refsToFetch.add(parseRefLine(ref));
        }
        for (const compare of decision.compare ?? []) {
          refsToFetch.add(parseRefLine(compare.left));
          refsToFetch.add(parseRefLine(compare.right));
        }
      }

      // Fetch in chunks with yielding
      const recordCache = new Map<number, unknown>();
      const refArray = Array.from(refsToFetch).sort((a, b) => a - b);

      for (let i = 0; i < refArray.length; i++) {
        const lineIdx = refArray[i];
        const parsed = await record(lineIdx);
        if (parsed.ok) {
          recordCache.set(lineIdx, parsed.data);
        }

        if (i % YIELD_INTERVAL === 0) {
          await new Promise((r) => setTimeout(r, 0));
          if (onProgress) {
            onProgress(i, refArray.length);
          }
        }
      }

      const getRecord = (i: number) => recordCache.get(i);

      const pairsResult = buildPairs(
        decisions,
        format,
        getRecord,
        excludeUnparseable ? isUnparseable : undefined
      );

      stats.tiesExcluded = pairsResult.excludedTies;
      stats.bothBadExcluded = pairsResult.excludedBothBad;
      stats.implicitPromptCount = pairsResult.implicitPromptCount;
      stats.skippedUnparseable = pairsResult.skippedUnparseable;

      if (name === 'pairs.jsonl') {
        blob = exportPairsJsonl(pairsResult.pairs);
        stats.pairsCount = pairsResult.pairs.length;
        stats.lineCount = pairsResult.pairs.length;
      } else {
        blob = exportPairsJsonl(pairsResult.editPairs);
        stats.editPairsCount = pairsResult.editPairs.length;
        stats.lineCount = pairsResult.editPairs.length;
      }
      break;
    }

    case 'all.decisions.jsonl': {
      // All records, in chunks
      // Unparseable lines are left out when asked, as the preview says (D-022)
      const include = excludeUnparseable
        ? (i: number) => {
            if (!isUnparseable(i)) return true;
            stats.unparseableExcluded++;
            return false;
          }
        : undefined;
      blob = await exportAllDecisions(source, decisions, record, format, onProgress, include);

      const total = source.kind === 'jsonl' ? source.index.lineCount : source.count;
      stats.lineCount = total - stats.unparseableExcluded;

      // Count edits
      for (const d of decisions.values()) {
        if (d.edits && Object.keys(d.edits).length > 0) {
          stats.editsExported++;
        }
      }
      break;
    }

    case 'kept.jsonl':
    case 'rejected.jsonl':
    case 'skipped.jsonl': {
      const targetStatus = name.replace('.jsonl', '') as 'kept' | 'rejected' | 'skipped';

      const include = (i: number, d?: ReturnType<typeof lineDecision>) => {
        if (excludeUnparseable && isUnparseable(i)) {
          stats.unparseableExcluded++;
          return false;
        }
        const matches = d?.status === targetStatus;
        if (matches) {
          stats.lineCount++;
          if (d?.edits && Object.keys(d.edits).length > 0) {
            stats.editsExported++;
          }
        }
        return matches;
      };

      if (source.kind === 'jsonl') {
        stats.byteExact = true;
        blob = await exportLines(source, decisions, include, { bom }, onProgress);
      } else {
        blob = await exportRows(source, decisions, include, onProgress);
      }
      break;
    }

    default:
      throw new Error(`Unknown export name: ${name}`);
  }

  if (onProgress) {
    onProgress(stats.lineCount, stats.lineCount);
  }

  return { blob, stats };
}
