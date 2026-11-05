/**
 * The prompt the cards answer, shown above them (D-013): the value at
 * promptPath for flat, candidates and preference formats. A conversation's
 * prompt is its earlier turns, which its card already shows.
 */

import type { RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import { getByPath, parsePath } from '../../lib/path';
import { displayValue } from '../../lib/display';
import { revealWhitespace } from '../../lib/whitespace';

export interface PromptHeaderProps {
  record: ParsedRecord | null;
  format: RecordFormat;
  showWhitespace: boolean;
}

export function PromptHeader({ record, format, showWhitespace }: PromptHeaderProps) {
  if (!record || !record.ok) return null;
  if (format.kind !== 'flat' && format.kind !== 'candidates' && format.kind !== 'preference') {
    return null;
  }

  let text: string | null = null;
  if (format.promptPath) {
    text = displayValue(getByPath(record.data, parsePath(format.promptPath)));
    if (showWhitespace) text = revealWhitespace(text);
  }

  return (
    <section aria-label="Prompt" className="mb-4 rounded-lg border bg-muted/30 p-4">
      <div className="text-xs font-medium text-muted-foreground mb-1">Prompt</div>
      {text === null ? (
        <div className="text-sm text-muted-foreground">(no prompt field)</div>
      ) : (
        <div className="whitespace-pre-wrap text-sm">{text}</div>
      )}
    </section>
  );
}
