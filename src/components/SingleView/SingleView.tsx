/**
 * Container for single mode: shows one record.
 * WP 6a: Auto-advances on decide() per WP 3 decision d.
 */

import type { CandidateRef, DecisionStatus, RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import type { EditValue } from '../../store/types';
import { ReviewCard } from '../ReviewCard';

export interface SingleViewProps {
  record: ParsedRecord;
  rawText: string;
  candidateRef: CandidateRef;
  format: RecordFormat;
  showRaw: boolean;
  showWhitespace: boolean;
  edits?: Record<string, EditValue>;
  onEdit?: (path: string) => void;
  status?: DecisionStatus;
}

export function SingleView({
  record,
  rawText,
  candidateRef,
  format,
  showRaw,
  showWhitespace,
  edits,
  onEdit,
  status,
}: SingleViewProps) {
  return (
    <div className="max-w-3xl mx-auto">
      <ReviewCard
        record={record}
        rawText={rawText}
        candidateRef={candidateRef}
        format={format}
        focused={true}
        showRaw={showRaw}
        showWhitespace={showWhitespace}
        edits={edits}
        onEdit={onEdit}
        status={status}
      />
    </div>
  );
}
