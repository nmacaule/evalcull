/**
 * Container for compare mode: shows two candidates side-by-side.
 * WP 6a: Handles Tab focus between left and right candidates.
 * WP 6c: Knockout over N candidates — "Pair k+1 of N−1", the "current best"
 * badge on the incumbent, and the judged preference once the prompt is complete.
 */

import type { CandidateRef, Preference, RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import type { EditValue } from '../../store/types';
import type { KnockoutState } from '../../lib/knockout';
import { ReviewCard } from '../ReviewCard';

export interface CompareViewProps {
  leftRecord: ParsedRecord;
  rightRecord: ParsedRecord;
  leftRef: CandidateRef;
  rightRef: CandidateRef;
  /** Raw text for left record */
  leftText: string;
  /** Raw text for right record */
  rightText: string;
  /** Edits for left ref */
  leftEdits?: Record<string, EditValue>;
  /** Edits for right ref */
  rightEdits?: Record<string, EditValue>;
  focus: 0 | 1;
  format: RecordFormat;
  showRaw: boolean;
  showWhitespace: boolean;
  /** Knockout state of the prompt (deriveKnockout) */
  knockout: KnockoutState;
  /** N, the number of candidates of the prompt */
  candidateCount: number;
  onEdit?: (ref: CandidateRef, path: string) => void;
}

const JUDGED_LABEL: Record<Preference, string> = {
  left: 'Judged: left preferred',
  right: 'Judged: right preferred',
  tie: 'Judged: tie',
  both_bad: 'Judged: both unacceptable',
};

export function CompareView({
  leftRecord,
  rightRecord,
  leftRef,
  rightRef,
  leftText,
  rightText,
  leftEdits,
  rightEdits,
  focus,
  format,
  showRaw,
  showWhitespace,
  knockout,
  candidateCount,
  onEdit,
}: CompareViewProps) {
  const incumbentSide = knockout.incumbent?.side;
  const judged = knockout.complete ? knockout.shown?.judged : undefined;

  return (
    <div className="flex flex-col gap-4">
      {/* Pair counter, only for prompts with more than two candidates */}
      {candidateCount > 2 && knockout.shown && (
        <div className="text-center text-sm text-muted-foreground">
          Pair {knockout.shown.pair + 1} of {knockout.totalPairs}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Left candidate */}
        <ReviewCard
          record={leftRecord}
          rawText={leftText}
          candidateRef={leftRef}
          format={format}
          focused={focus === 0}
          showRaw={showRaw}
          showWhitespace={showWhitespace}
          edits={leftEdits}
          onEdit={onEdit ? (path) => onEdit(leftRef, path) : undefined}
          badge={incumbentSide === 'left' ? 'current best' : undefined}
        />

        {/* Right candidate */}
        <ReviewCard
          record={rightRecord}
          rawText={rightText}
          candidateRef={rightRef}
          format={format}
          focused={focus === 1}
          showRaw={showRaw}
          showWhitespace={showWhitespace}
          edits={rightEdits}
          onEdit={onEdit ? (path) => onEdit(rightRef, path) : undefined}
          badge={incumbentSide === 'right' ? 'current best' : undefined}
        />
      </div>

      {/* A completed prompt shows its last judged pair with the preference marked */}
      {judged && (
        <div className="text-center text-sm text-muted-foreground">
          {JUDGED_LABEL[judged]}
        </div>
      )}
    </div>
  );
}
