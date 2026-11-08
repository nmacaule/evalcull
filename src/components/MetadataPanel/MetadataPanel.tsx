/**
 * Collapsible metadata panel (PRD §2.8, M): every field of the focused
 * candidate's record not mapped to the cards, digits as written, an unsafe
 * integer badged (PRD §2.4).
 */

import type { RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import { unmappedFields } from '../../lib/metadata';
import { StatusMark } from '../StatusMark';

export interface MetadataPanelProps {
  record: ParsedRecord | null;
  format: RecordFormat;
  /** The ref the card's title replaced (DR-032) */
  candidateRef?: string;
}

export function MetadataPanel({ record, format, candidateRef }: MetadataPanelProps) {
  const fields = record?.ok ? unmappedFields(record.data, format) : [];
  return (
    <section aria-label="Metadata" className="mt-6 rounded-panel bg-neutral-2 p-4 text-chrome animate-panel">
      <h2 className="label text-neutral-11 mb-2">Metadata</h2>
      {candidateRef && <p className="font-mono text-mono text-neutral-11 mb-2">Ref {candidateRef}</p>}
      {!record || !record.ok ? (
        <p className="text-neutral-11">Unparseable line: no fields.</p>
      ) : fields.length === 0 ? (
        <p className="text-neutral-11">No other fields.</p>
      ) : (
        <dl className="kv-grid gap-x-4 gap-y-1">
          {fields.map((f) => (
            <div key={f.key} className="contents" data-field={f.key}>
              <dt className="font-mono text-mono text-neutral-11">{f.key}</dt>
              <dd className="font-mono text-mono text-neutral-12 whitespace-pre-wrap break-all">
                {f.text}
                {f.unsafeInteger && (
                  // An informational badge: a word and dot in neutral-11 (DR-017)
                  <StatusMark tone="quiet" word="unsafe integer" className="ml-2 font-sans" />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
