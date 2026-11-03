/**
 * Export all.decisions.jsonl: every record plus _triage field.
 * Always re-serialised with lossless-json.
 */

import type { RecordSource, CandidateRef, Decision } from '../types';
import type { ParsedRecord } from '../store/types';
import { formatPromptRef } from '../store/refs';
import { losslessStringify } from '../lib/lossless';

const YIELD_INTERVAL = 5000;

/**
 * Build _triage field for a decision.
 * Field order: { status, compare, labels, score, notes, edited, updatedAt }
 */
function buildTriage(d: Decision | undefined): Record<string, unknown> {
  const triage: Record<string, unknown> = {
    status: d?.status ?? 'unreviewed',
  };

  if (d?.compare) {
    triage.compare = d.compare; // includes strength if present
  }

  if (d?.labels && d.labels.length > 0) {
    triage.labels = d.labels;
  }

  if (d?.score !== undefined) {
    triage.score = d.score;
  }

  if (d?.notes !== undefined) {
    triage.notes = d.notes;
  }

  triage.edited = !!(d?.edits && Object.keys(d.edits).length > 0);
  triage.updatedAt = d?.updatedAt ?? 0;

  return triage;
}

/**
 * Export all records with _triage field appended.
 *
 * @param src Record source
 * @param decisions Map of decisions keyed by CandidateRef
 * @param record Function to fetch parsed record
 * @param onProgress Optional progress callback
 */
export async function exportAllDecisions(
  src: RecordSource,
  decisions: Map<CandidateRef, Decision>,
  record: (i: number) => Promise<ParsedRecord>,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const parts: string[] = [];
  const total = src.kind === 'jsonl' ? src.index.lineCount : src.count;

  for (let i = 0; i < total; i++) {
    const parsed = await record(i);
    const ref = formatPromptRef(i);
    const d = decisions.get(ref);

    if (parsed.ok) {
      // Append _triage after record's own keys
      const output = {
        ...(parsed.data as Record<string, unknown>),
        _triage: buildTriage(d),
      };
      parts.push(losslessStringify(output) + '\n');
    } else {
      // Unparseable: emit raw text with _triage only
      const output = {
        _raw: parsed.raw,
        _triage: buildTriage(d),
      };
      parts.push(losslessStringify(output) + '\n');
    }

    // Yield to allow page paint
    if (i % YIELD_INTERVAL === 0) {
      await new Promise((r) => setTimeout(r, 0));
      if (onProgress) {
        onProgress(i, total);
      }
    }
  }

  if (onProgress) {
    onProgress(total, total);
  }

  return new Blob(parts, { type: 'application/jsonl' });
}
