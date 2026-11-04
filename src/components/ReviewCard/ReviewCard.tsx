/**
 * Shared card component rendering one candidate.
 * WP 6a: Shows status badge, edit indicator, supports raw/rendered view.
 * WP 6c: Renders the candidate its ref names (i:k for in-record formats) and an
 * optional badge such as "current best".
 */

import { useMemo, useState } from 'react';
import type { CandidateRef, RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import type { EditValue } from '../../store/types';
import { getByPath, parsePath } from '../../lib/path';
import { RawView } from '../RawView';
import { ConversationView } from '../ConversationView';

/** Render unknown value: strings as-is, anything else via JSON.stringify */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

export interface ReviewCardProps {
  record: ParsedRecord;
  /** Raw text of the record for raw view */
  rawText: string;
  candidateRef: CandidateRef;
  format: RecordFormat;
  focused: boolean;
  showRaw: boolean;
  showWhitespace: boolean;
  /** Edits from decisions map */
  edits?: Record<string, EditValue>;
  onEdit?: (path: string) => void;
  /** Optional header badge, e.g. "current best" on a knockout incumbent */
  badge?: string;
}

interface ContentRendererProps {
  record: ParsedRecord;
  format: RecordFormat;
  /** Candidate index k of an "i:k" ref; null for a line ref "i" */
  candidateIndex: number | null;
  onSelectTurn: (index: number) => void;
  selectedTurnIndex: number | null;
}

/** k of an "i:k" ref, or null for a line ref. */
function candidateIndexOf(ref: CandidateRef): number | null {
  const colon = ref.indexOf(':');
  return colon === -1 ? null : parseInt(ref.slice(colon + 1), 10);
}

function ContentRenderer({
  record,
  format,
  candidateIndex,
  onSelectTurn,
  selectedTurnIndex,
}: ContentRendererProps) {
  // Handle parse errors
  if (!record.ok) {
    return (
      <div className="text-sm text-destructive">
        Parse error: {record.error}
      </div>
    );
  }

  const data = record.data;

  switch (format.kind) {
    case 'flat': {
      const response = getByPath(data, parsePath(format.responsePath));
      return (
        <div className="whitespace-pre-wrap text-sm">
          {String(response ?? '')}
        </div>
      );
    }

    case 'messages': {
      const messages = getByPath(data, parsePath(format.path));
      if (!Array.isArray(messages)) {
        return <div className="text-sm text-muted-foreground">(no messages)</div>;
      }
      const typedMessages = messages.map((msg: unknown) => {
        const m = msg as Record<string, unknown>;
        return {
          role: String(m[format.roleKey] ?? ''),
          content: String(m[format.contentKey] ?? ''),
        };
      });
      return (
        <ConversationView
          messages={typedMessages}
          roles={format.roles}
          editingTurnIndex={selectedTurnIndex}
          onSelectTurn={onSelectTurn}
        />
      );
    }

    case 'preference': {
      // "i:0" is chosen and "i:1" rejected; a line ref "i" shows both
      const chosen =
        format.chosenPath && candidateIndex !== 1
          ? getByPath(data, parsePath(format.chosenPath))
          : null;
      const rejected =
        format.rejectedPath && candidateIndex !== 0
          ? getByPath(data, parsePath(format.rejectedPath))
          : null;
      const hasChosen = chosen !== null && chosen !== undefined;
      const hasRejected = rejected !== null && rejected !== undefined;
      return (
        <div className="flex flex-col gap-2">
          {hasChosen && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Chosen
              </div>
              <div className="whitespace-pre-wrap text-sm">{renderValue(chosen)}</div>
            </div>
          )}
          {hasRejected && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Rejected
              </div>
              <div className="whitespace-pre-wrap text-sm">{renderValue(rejected)}</div>
            </div>
          )}
        </div>
      );
    }

    case 'candidates': {
      const candidates = getByPath(data, parsePath(format.candidatesPath));
      if (!Array.isArray(candidates)) {
        return <div className="text-sm text-muted-foreground">(no candidates)</div>;
      }
      // "i:k" names candidates[k]; a line ref "i" shows the first, as before
      return (
        <div className="whitespace-pre-wrap text-sm">
          {renderValue(candidates[candidateIndex ?? 0])}
        </div>
      );
    }

    case 'unknown':
    default:
      return (
        <div className="text-sm text-muted-foreground">
          Unknown format - use raw view
        </div>
      );
  }
}

export function ReviewCard({
  record,
  rawText,
  candidateRef,
  format,
  focused,
  showRaw,
  showWhitespace,
  edits,
  onEdit,
  badge,
}: ReviewCardProps) {
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);

  // Check if this record has edits
  const hasEdits = edits && Object.keys(edits).length > 0;

  // Handle turn selection for messages format
  const handleSelectTurn = useMemo(() => {
    if (format.kind !== 'messages' || !onEdit) return () => {};
    return (index: number) => {
      setSelectedTurnIndex(index);
      const path = `${format.path}[${index}].${format.contentKey}`;
      onEdit(path);
    };
  }, [format, onEdit]);

  return (
    // The keys act on the focused card, so assistive technology must see it as
    // well as the ring: role="group" puts the card in the accessibility tree and
    // aria-current marks the current one of the cards shown (D-007)
    <div
      className={`flex flex-col gap-2 rounded-lg border p-4 ${
        focused ? 'ring-2 ring-primary' : ''
      }`}
      role="group"
      aria-current={focused ? 'true' : undefined}
      data-candidate-ref={candidateRef}
    >
      {/* Header with status badges */}
      <div className="flex items-center gap-2">
        {badge && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary text-primary-foreground">
            {badge}
          </span>
        )}
        {hasEdits && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            edited
          </span>
        )}
        <span className="text-xs text-muted-foreground font-mono">
          {candidateRef}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {showRaw || format.kind === 'unknown' ? (
          <RawView text={rawText} showWhitespace={showWhitespace} />
        ) : (
          <ContentRenderer
            record={record}
            format={format}
            candidateIndex={candidateIndexOf(candidateRef)}
            onSelectTurn={handleSelectTurn}
            selectedTurnIndex={selectedTurnIndex}
          />
        )}
      </div>
    </div>
  );
}
