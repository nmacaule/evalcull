/**
 * Shared card component rendering one candidate.
 * WP 6a: Shows status badge, edit indicator, supports raw/rendered view.
 * WP 6c: Renders the candidate its ref names (i:k for in-record formats) and an
 * optional badge such as "current best".
 * WP 6b: Shows the edited values (D-014), non-strings through lossless-json
 * (D-015), the candidate's status (D-016) and W's whitespace reveal (D-025).
 */

import { useMemo, useState } from 'react';
import type { CandidateRef, DecisionStatus, RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import type { EditValue } from '../../store/types';
import { getByPath, parsePath, setByPath } from '../../lib/path';
import { displayValue } from '../../lib/display';
import { revealWhitespace } from '../../lib/whitespace';
import { RawView } from '../RawView';
import { DiffView } from '../DiffView';
import { ConversationView } from '../ConversationView';

/** The record's data with each edit applied; setByPath copies, so the cached record is untouched (D-014). */
function withEdits(data: unknown, edits: Record<string, EditValue> | undefined): unknown {
  if (!edits) return data;
  let out = data;
  for (const [path, value] of Object.entries(edits)) {
    out = setByPath(out, parsePath(path), value);
  }
  return out;
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
  /** The candidate's status; kept, rejected and skipped are badged (D-016) */
  status?: DecisionStatus;
}

interface ContentRendererProps {
  record: ParsedRecord;
  /** The record's data with its edits applied */
  data: unknown;
  /** Display text for a value, with whitespace revealed when W is on */
  show: (value: unknown) => string;
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
  data,
  show,
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

  switch (format.kind) {
    case 'flat': {
      const response = getByPath(data, parsePath(format.responsePath));
      return (
        <div className="whitespace-pre-wrap text-sm">
          {show(response)}
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
          content: show(m[format.contentKey]),
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
      // "i:0" is chosen and "i:1" rejected; a line ref "i" shows both. A null
      // value is shown as null; only a missing one is left out (D-030)
      const chosen =
        format.chosenPath && candidateIndex !== 1
          ? getByPath(data, parsePath(format.chosenPath))
          : undefined;
      const rejected =
        format.rejectedPath && candidateIndex !== 0
          ? getByPath(data, parsePath(format.rejectedPath))
          : undefined;
      const hasChosen = chosen !== undefined;
      const hasRejected = rejected !== undefined;
      return (
        <div className="flex flex-col gap-2">
          {hasChosen && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Chosen
              </div>
              <div className="whitespace-pre-wrap text-sm">{show(chosen)}</div>
            </div>
          )}
          {hasRejected && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Rejected
              </div>
              <div className="whitespace-pre-wrap text-sm">{show(rejected)}</div>
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
          {show(candidates[candidateIndex ?? 0])}
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
  status,
}: ReviewCardProps) {
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);
  // The edited badge toggles the card between its edited values and their diff (PRD §2.5)
  const [showDiff, setShowDiff] = useState(false);

  // Check if this record has edits
  const hasEdits = edits && Object.keys(edits).length > 0;

  const data = useMemo(
    () => (record.ok ? withEdits(record.data, edits) : undefined),
    [record, edits]
  );
  const show = useMemo(
    () => (value: unknown) => {
      const text = displayValue(value);
      return showWhitespace ? revealWhitespace(text) : text;
    },
    [showWhitespace]
  );

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
        {status && status !== 'unreviewed' && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-foreground">
            {status}
          </span>
        )}
        {hasEdits && (
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            aria-pressed={showDiff}
            title={showDiff ? 'Show the edited value' : 'Show the diff against the original'}
            className="text-xs font-medium px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
          >
            edited
          </button>
        )}
        <span className="text-xs text-muted-foreground font-mono">
          {candidateRef}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto max-h-[60vh]" data-card-content>
        {showDiff && hasEdits && record.ok ? (
          <div className="flex flex-col gap-2">
            {Object.entries(edits!).map(([path, value]) => (
              <div key={path}>
                <div className="text-xs font-mono text-muted-foreground mb-1">{path}</div>
                <DiffView
                  original={displayValue(getByPath(record.data, parsePath(path)))}
                  edited={displayValue(value)}
                />
              </div>
            ))}
          </div>
        ) : showRaw || format.kind === 'unknown' ? (
          <RawView text={rawText} showWhitespace={showWhitespace} />
        ) : (
          <ContentRenderer
            record={record}
            data={data}
            show={show}
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
