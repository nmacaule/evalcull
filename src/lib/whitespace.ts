/**
 * Whitespace reveal for W (PRD §2.6): a middle dot for a space, an arrow
 * before a tab and a return symbol before each line end. One pass, so a CRLF
 * is marked once (D-026).
 */

export function revealWhitespace(text: string): string {
  return text.replace(/\r?\n| |\t/g, (match) => {
    if (match === ' ') return '·';
    if (match === '\t') return '→\t';
    return '↵' + match;
  });
}
