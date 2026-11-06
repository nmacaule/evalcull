/**
 * Export all.decisions.jsonl: every record plus _triage field (PRD §2.10).
 * An unedited, parseable object record keeps its own bytes with _triage spliced
 * before its closing brace; edited, non-object and unparseable records, and those
 * holding \u or "_triage", are re-serialised with lossless-json (DR-014).
 */

import type { RecordSource, CandidateRef, Decision, RecordFormat } from '../types';
import type { ParsedRecord } from '../store/types';
import { formatPromptRef, groupByLine, lineDecision, parseRefLine } from '../store/refs';
import { isLosslessNumber } from 'lossless-json';
import { losslessParse, losslessStringify } from '../lib/lossless';
import { parsePath, setByPath } from '../lib/path';
import { readWindows } from './windows';

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

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
const TRIAGE_KEY = new TextEncoder().encode('"_triage"');

/** Whether the bytes hold the given sequence. */
function holds(bytes: Uint8Array, seq: Uint8Array): boolean {
  outer: for (let p = 0; p + seq.length <= bytes.length; p++) {
    for (let q = 0; q < seq.length; q++) if (bytes[p + q] !== seq[q]) continue outer;
    return true;
  }
  return false;
}

/**
 * Where _triage goes in a parseable record's own bytes (DR-014): the index of its
 * closing brace, and whether the object is empty; null when the record must be
 * re-serialised instead: not an object, holding "_triage", or holding the two
 * characters \u, under which a name such as \u005ftriage could hide.
 */
function spliceAt(line: Uint8Array): { close: number; empty: boolean } | null {
  let open = 0;
  while (open < line.length && WS.has(line[open])) open++;
  if (line[open] !== 0x7b) return null; // {
  let close = line.length - 1;
  while (close > open && WS.has(line[close])) close--;
  if (close <= open || line[close] !== 0x7d) return null; // }
  for (let p = 0; p + 1 < line.length; p++) {
    if (line[p] === 0x5c && line[p + 1] === 0x75) return null; // \u
  }
  if (holds(line, TRIAGE_KEY)) return null;
  let inner = open + 1;
  while (inner < close && WS.has(line[inner])) inner++;
  return { close, empty: inner === close };
}

/** One window's output, written as bytes into a buffer that grows by doubling. */
class ByteBuilder {
  private buf: Uint8Array<ArrayBuffer>;
  private len = 0;
  private readonly encoder = new TextEncoder();

  constructor(capacity: number) {
    this.buf = new Uint8Array(capacity);
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  text(t: string): void {
    // A UTF-16 code unit encodes to at most three bytes
    this.ensure(t.length * 3);
    this.len += this.encoder.encodeInto(t, this.buf.subarray(this.len)).written;
  }

  /** The bytes written, in a buffer of their own size. */
  result(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.len);
  }
}

/**
 * Export all records with _triage field appended.
 *
 * @param src Record source
 * @param decisions Map of decisions keyed by CandidateRef
 * @param record Function to fetch parsed record
 * @param format The record format, which decides whether lines carry in-record candidates
 * @param onProgress Optional progress callback
 * @param include Optional line filter; a line it rejects is not written (D-022)
 */
export async function exportAllDecisions(
  src: RecordSource,
  decisions: Map<CandidateRef, Decision>,
  record: (i: number) => Promise<ParsedRecord>,
  format: RecordFormat,
  onProgress?: (done: number, total: number) => void,
  include?: (i: number) => boolean
): Promise<Blob> {
  const parts: BlobPart[] = [];
  const total = src.kind === 'jsonl' ? src.index.lineCount : src.count;
  const candidatesByLine = candidateDecisionsByLine(src, decisions, format);
  const byLine = groupByLine(decisions);

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

  // One record re-serialised, without a terminator: the merged edits of "i" and "i:k"
  // applied, edited following the merged line (D-028), _triage last; a value that is
  // not a JSON object goes under _value (D-023, D-096); an unparseable line under _raw
  const reserialised = (i: number, parsed: ParsedRecord): string => {
    const d = decisions.get(formatPromptRef(i));
    if (!parsed.ok) return losslessStringify({ _raw: parsed.raw, _triage: triageFor(i, d) }) ?? '';
    const edits = lineDecision(decisions, byLine, i)?.edits ?? {};
    let data = parsed.data;
    for (const [path, value] of Object.entries(edits)) {
      data = setByPath(data, parsePath(path), value);
    }
    const triage = triageFor(i, d);
    triage.edited = Object.keys(edits).length > 0;
    // A lossless-json number is an object instance but not a JSON object (D-096)
    const isObject =
      data !== null && typeof data === 'object' && !Array.isArray(data) && !isLosslessNumber(data);
    // A record's own _triage member is left out, so the export's is always last; spread
    // over the record, it would keep the old member's position (D-097)
    let output: Record<string, unknown>;
    if (isObject) {
      const { _triage: _own, ...rest } = data as Record<string, unknown>;
      void _own;
      output = { ...rest, _triage: triage };
    } else {
      output = { _value: data, _triage: triage };
    }
    return losslessStringify(output) ?? '';
  };

  if (src.kind === 'jsonl') {
    // The lines come out of windows read with one readRawRange each (DR-013, D-095).
    // An unedited, parseable object record keeps its own bytes with _triage spliced
    // before its closing brace (DR-014); every other line is re-serialised. Each
    // window's output is built as bytes, so no line's text is kept as a string.
    const idx = src.index;
    const unparseable = new Set(idx.unparseable);
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    for await (const win of readWindows(src)) {
      const out = new ByteBuilder(Math.ceil(win.bytes.length * 1.75) + 4096);
      for (let i = win.first; i <= win.last; i++) {
        if (!include || include(i)) {
          const line = win.line(i);
          const hasEdits = Object.keys(lineDecision(decisions, byLine, i)?.edits ?? {}).length > 0;
          const splice = unparseable.has(i) || hasEdits ? null : spliceAt(line);
          if (splice) {
            const triage = triageFor(i, decisions.get(formatPromptRef(i)));
            triage.edited = false;
            out.bytes(line.subarray(0, splice.close));
            out.text(`${splice.empty ? '' : ','}"_triage":${losslessStringify(triage)}}`);
            // The line's own terminator (DR-014)
            out.bytes(win.lineWithEol(i).subarray(line.length));
          } else {
            const text = decoder.decode(line);
            let parsed: ParsedRecord;
            try {
              parsed = { index: i, ok: true, data: losslessParse(text) };
            } catch (err) {
              parsed = { index: i, ok: false, error: String(err), raw: text };
            }
            out.text(reserialised(i, parsed));
            // The line's own terminator on this path too, none after an unterminated
            // last line, as kept.jsonl writes it (DR-014 amendment)
            out.bytes(win.lineWithEol(i).subarray(line.length));
          }
        }

        // Yield to allow page paint
        if (i % YIELD_INTERVAL === 0) {
          await new Promise((r) => setTimeout(r, 0));
          if (onProgress) {
            onProgress(i, total);
          }
        }
      }
      parts.push(out.result());
    }
  } else {
    for (let i = 0; i < total; i++) {
      if (!include || include(i)) parts.push(reserialised(i, await record(i)) + '\n');

      // Yield to allow page paint
      if (i % YIELD_INTERVAL === 0) {
        await new Promise((r) => setTimeout(r, 0));
        if (onProgress) {
          onProgress(i, total);
        }
      }
    }
  }

  if (onProgress) {
    onProgress(total, total);
  }

  return new Blob(parts, { type: 'application/jsonl' });
}
