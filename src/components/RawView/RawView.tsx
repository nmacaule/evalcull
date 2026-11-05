/**
 * Raw JSON display with optional whitespace reveal.
 * WP 6a: Used for unknown shapes and on-demand raw view.
 */

import { useMemo } from 'react';
import { revealWhitespace } from '../../lib/whitespace';

export interface RawViewProps {
  text: string;
  showWhitespace: boolean;
}

export function RawView({ text, showWhitespace }: RawViewProps) {
  const displayText = useMemo(() => {
    return showWhitespace ? revealWhitespace(text) : text;
  }, [text, showWhitespace]);

  return (
    <pre className="overflow-auto whitespace-pre-wrap font-mono text-sm bg-muted/50 p-4 rounded-md">
      {displayText}
    </pre>
  );
}
