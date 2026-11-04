/**
 * Export all.decisions.jsonl: every record plus _triage field.
 * Always re-serialised with lossless-json.
 */

import type { RecordSource, CandidateRef, Decision, RecordFormat } from '../types';
import type { ParsedRecord } from '../store/types';
import { formatPromptRef, parseRefLine } from '../store/refs';
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
 * Decisions on in-record candidates ("i:k" with k below line i's count), by
 * line, for _triage.candidates (D-011). Empty for row formats, whose candidates
 * are line refs.
 */
function candidateDecisionsByLine(
  src: RecordSource,
  decisions: Map<CandidateRef, Decision>,
  format: RecordFormat
): Map<number, Array<[number, Decision]>> {
  const byLine = new Map<number, Array<[number, Decision]>>();
  if (src.kind !== 'jsonl' || (format.kind !== 'candidates' && format.kind !== 'preference')) {
    return byLine;
  }
  for (const [ref, d] of decisions) {
    const colon = ref.indexOf(':');
    if (colon === -1) continue;
    const line = parseRefLine(ref);
    const k = Number(ref.slice(colon + 1));
    if (line >= src.index.lineCount || k >= src.index.candidates[line]) continue;
    const list = byLine.get(line) ?? [];
    list.push([k, d]);
    byLine.set(line, list);
  }
  for (const list of byLine.values()) list.sort((a, b) => a[0] - b[0]);
  return byLine;
}

/**
 * Export all records with _triage field appended.
 *
 * @param src Record source
 * @param decisions Map of decisions keyed by CandidateRef
 * @param record Function to fetch parsed record
 * @param format The record format, which decides whether lines carry in-record candidates
 * @param onProgress Optional progress callback
 */
export async function exportAllDecisions(
  src: RecordSource,
  decisions: Map<CandidateRef, Decision>,
  record: (i: number) => Promise<ParsedRecord>,
  format: RecordFormat,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  const parts: string[] = [];
  const total = src.kind === 'jsonl' ? src.index.lineCount : src.count;
  const candidatesByLine = candidateDecisionsByLine(src, decisions, format);

  // _triage, then after updatedAt the per-candidate triage of an in-record line
  // with at least one candidate decision, keyed by k (D-011); absent otherwise
  const triageFor = (i: number, d: Decision | undefined): Record<string, unknown> => {
    const triage = buildTriage(d);
    const list = candidatesByLine.get(i);
    if (list) {
      const candidates: Record<string, unknown> = {};
      for (const [k, cd] of list) {
        // A candidate value holds status, labels, score, notes, edited, updatedAt only:
        // a compare on an i:k entry (hand-edited or imported) is not exported (D-012)
        const { compare: _compare, ...rest } = cd;
        void _compare;
        candidates[String(k)] = buildTriage(rest);
      }
      triage.candidates = candidates;
    }
    return triage;
  };

  for (let i = 0; i < total; i++) {
    const parsed = await record(i);
    const ref = formatPromptRef(i);
    const d = decisions.get(ref);

    if (parsed.ok) {
      // Append _triage after record's own keys
      const output = {
        ...(parsed.data as Record<string, unknown>),
        _triage: triageFor(i, d),
      };
      parts.push(losslessStringify(output) + '\n');
    } else {
      // Unparseable: emit raw text with _triage only
      const output = {
        _raw: parsed.raw,
        _triage: triageFor(i, d),
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
