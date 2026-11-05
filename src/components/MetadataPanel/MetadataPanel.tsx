/**
 * Collapsible metadata panel (PRD §2.8, M): every field of the focused
 * candidate's record not mapped to the cards, digits as written, an unsafe
 * integer badged (PRD §2.4).
 */

import type { RecordFormat } from '../../types';
import type { ParsedRecord } from '../../store/types';
import { unmappedFields } from '../../lib/metadata';

export interface MetadataPanelProps {
  record: ParsedRecord | null;
  format: RecordFormat;
}

export function MetadataPanel({ record, format }: MetadataPanelProps) {
  const fields = record?.ok ? unmappedFields(record.data, format) : [];
  return (
    <section aria-label="Metadata" className="mt-4 rounded-lg border p-4">
      <h2 className="text-sm font-semibold mb-2">Metadata</h2>
      {!record || !record.ok ? (
        <p className="text-sm text-muted-foreground">Unparseable line: no fields.</p>
      ) : fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other fields.</p>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {fields.map((f) => (
            <div key={f.key} className="contents" data-field={f.key}>
              <dt className="font-mono text-muted-foreground">{f.key}</dt>
              <dd className="font-mono whitespace-pre-wrap break-all">
                {f.text}
                {f.unsafeInteger && (
                  <span className="ml-2 text-xs font-sans px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    unsafe integer
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
