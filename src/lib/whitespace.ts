/**
 * Whitespace reveal for W (PRD §2.6): a middle dot for a space, an arrow
 * before a tab and a return symbol before each line end. One pass, so a CRLF
 * is marked once (D-026). Each mark is its own part, so it can take the mark
 * colour, neutral-11 (PRD §2.11 screen 5, DR-022).
 */

export interface WhitespacePart {
  text: string;
  /** A mark the reveal added, with the whitespace it stands before */
  mark: boolean;
}

export function whitespaceParts(text: string): WhitespacePart[] {
  const parts: WhitespacePart[] = [];
  let last = 0;
  for (const m of text.matchAll(/\r?\n| |\t/g)) {
    const at = m.index!;
    if (at > last) parts.push({ text: text.slice(last, at), mark: false });
    const ws = m[0];
    parts.push({ text: ws === ' ' ? '·' : ws === '\t' ? '→\t' : '↵' + ws, mark: true });
    last = at + ws.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mark: false });
  return parts;
}
