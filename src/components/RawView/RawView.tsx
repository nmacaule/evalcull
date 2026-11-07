/**
 * Raw JSON display with optional whitespace reveal.
 * WP 6a: Used for unknown shapes and on-demand raw view.
 * WP 7b: text-mono on neutral-2 (PRD §2.11 screen 5); Revealed renders the
 * reveal's marks as their own spans in neutral-11 (DR-022), for every path that
 * shows whitespace.
 */

import { useMemo } from 'react';
import { whitespaceParts } from '../../lib/whitespace';

/** Text with W's marks, each in a mark span, or the text as it is. */
export function Revealed({ text, show }: { text: string; show: boolean }) {
  // One pass per text while W is on, not per render
  const parts = useMemo(() => (show ? whitespaceParts(text) : null), [text, show]);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? (
          <span key={i} data-ws-mark className="text-neutral-11">
            {p.text}
          </span>
        ) : (
          p.text
        )
      )}
    </>
  );
}

export interface RawViewProps {
  text: string;
  showWhitespace: boolean;
}

export function RawView({ text, showWhitespace }: RawViewProps) {
  return (
    <pre className="overflow-auto whitespace-pre-wrap font-mono text-mono text-neutral-12 bg-neutral-2 p-4 rounded-panel">
      <Revealed text={text} show={showWhitespace} />
    </pre>
  );
}
