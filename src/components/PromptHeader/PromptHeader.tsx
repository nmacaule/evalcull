/**
 * The prompt the cards answer, shown above them (D-013): the value at
 * promptPath for flat, candidates and preference formats. A conversation's
 * prompt is its earlier turns, which its card already shows.
 * WP 7b (PRD §2.11): a panel on neutral-2, its label as text-label, the prompt
 * as text-content within 70ch; W's marks through Revealed (DR-022).
 */

import type { RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import { getByPath, parsePath } from '../../lib/path';
import { displayValue } from '../../lib/display';
import { Revealed } from '../RawView';

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
  }

  return (
    <section aria-label="Prompt" className="mb-6 rounded-panel bg-neutral-2 p-4">
      <div className="label text-neutral-11 mb-1">Prompt</div>
      {text === null ? (
        <div className="text-chrome text-neutral-11">(no prompt field)</div>
      ) : (
        <div className="whitespace-pre-wrap text-content text-neutral-12 max-w-content">
          <Revealed text={text} show={showWhitespace} />
        </div>
      )}
    </section>
  );
}
