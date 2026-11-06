/**
 * The three Phase 0 samples, embedded in the build (PRD §4 Phase 0, DR-010):
 * the empty page opens one with a single action, through the same path as a
 * dropped file, with no request. The same files are published beside index.html.
 */

import conversation from '../../samples/conversation.jsonl?raw';
import preference from '../../samples/preference.jsonl?raw';
import candidates from '../../samples/candidates.jsonl?raw';

// 15 Nov 2026 00:00 UTC: fixed, so a sample's fingerprint (name, size, lastModified)
// is the same on every visit and its saved session restores
const SAMPLE_LAST_MODIFIED = 1794700800000;

export interface Sample {
  /** Shown as "Open sample: {label}" */
  label: string;
  name: string;
  text: string;
}

export const SAMPLES: readonly Sample[] = [
  { label: 'conversation', name: 'conversation.jsonl', text: conversation },
  { label: 'preference', name: 'preference.jsonl', text: preference },
  { label: 'candidates', name: 'candidates.jsonl', text: candidates },
];

/** The sample as a File, as a drop would give it. */
export function sampleFile(sample: Sample): File {
  return new File([sample.text], sample.name, { type: 'application/jsonl', lastModified: SAMPLE_LAST_MODIFIED });
}
