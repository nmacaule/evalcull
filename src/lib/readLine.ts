/**
 * Line reading helper with BOM stripping.
 *
 * Reads a line from a Blob given start/end offsets,
 * stripping UTF-8 BOM from line 0 when hasBom is true.
 *
 * Uses ignoreBOM: true so the decoder does NOT auto-strip BOM bytes.
 * This ensures a U+FEFF appearing inside a line (after line 0) is preserved.
 * BOM stripping for line 0 is done explicitly via byte offset.
 */

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * Read a line's text from a blob, stripping BOM from line 0 if present.
 *
 * @param blob Source blob
 * @param start Start offset in bytes
 * @param end End offset in bytes (before line ending)
 * @param lineIndex Line index (0-based)
 * @param hasBom Whether the blob starts with a UTF-8 BOM
 */
export async function readLineText(
  blob: Blob,
  start: number,
  end: number,
  lineIndex: number,
  hasBom: boolean
): Promise<string> {
  // Skip BOM bytes explicitly for line 0 only (not via decoder)
  const actualStart = lineIndex === 0 && hasBom ? Math.max(start, 3) : start;
  const slice = blob.slice(actualStart, end);
  const buffer = await slice.arrayBuffer();
  return decoder.decode(buffer);
}
