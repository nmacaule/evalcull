/**
 * Raw JSON display with optional whitespace reveal.
 * WP 6a: Used for unknown shapes and on-demand raw view.
 */

import { useMemo } from 'react';

export interface RawViewProps {
  text: string;
  showWhitespace: boolean;
}

/**
 * Reveal whitespace characters with visible markers.
 */
function revealWhitespace(text: string): string {
  return text
    .replace(/ /g, '\u00B7') // middle dot for space
    .replace(/\t/g, '\u2192\t') // arrow for tab
    .replace(/\r\n/g, '\u21B5\r\n') // return symbol for CRLF
    .replace(/\n/g, '\u21B5\n'); // return symbol for LF
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
