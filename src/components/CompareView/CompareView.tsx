/**
 * Container for compare mode: shows two candidates side-by-side.
 * WP 6a: Handles Tab focus between left and right candidates.
 */

import type { CandidateRef, RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import type { EditValue } from '../../store/types';
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
  /** Total candidates in group (for "N more" message) */
  groupSize: number;
  onEdit?: (ref: CandidateRef, path: string) => void;
}

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
  groupSize,
  onEdit,
}: CompareViewProps) {
  const extraCandidates = groupSize - 2;

  return (
    <div className="flex flex-col gap-4">
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
        />
      </div>

      {/* Show message if there are more candidates in this group */}
      {extraCandidates > 0 && (
        <div className="text-center text-sm text-muted-foreground">
          {extraCandidates} more candidate{extraCandidates > 1 ? 's' : ''} in
          this group
        </div>
      )}
    </div>
  );
}
