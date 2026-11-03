/**
 * Detect unparseable lines in a JSONL blob.
 *
 * Streams blob in chunks, decodes and JSON.parse each line.
 * Uses the same chunk-streaming pattern as the indexer to avoid
 * 1.1 million blob.slice() async calls.
 */

export async function detectUnparseable(
  blob: Blob,
  starts: Float64Array,
  ends: Float64Array,
  hasBom: boolean
): Promise<Uint32Array> {
  const lineCount = starts.length;
  if (lineCount === 0) {
    return new Uint32Array(0);
  }

  const unparseable: number[] = [];
  const decoder = new TextDecoder('utf-8'); // default strips BOM from line 0

  // Stream the blob in chunks, tracking position
  const reader = blob.stream().getReader();
  let buffer = new Uint8Array(0);
  let bufferStart = 0; // absolute position of buffer[0] in the file
  let lineIdx = 0;

  for (;;) {
    const { value, done } = await reader.read();

    if (value) {
      // Append chunk to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;
    }

    // Process all complete lines we can from the buffer
    while (lineIdx < lineCount) {
      const lineStart = starts[lineIdx];
      const lineEnd = ends[lineIdx];

      // Check if this line is fully in the buffer
      const localStart = lineStart - bufferStart;
      const localEnd = lineEnd - bufferStart;

      if (localEnd > buffer.length) {
        // Need more data for this line
        break;
      }

      // Extract line bytes
      let lineBytes: Uint8Array;
      if (lineIdx === 0 && hasBom && localStart === 0) {
        // Skip BOM for line 0 (TextDecoder default strips it, but we slice explicitly)
        lineBytes = buffer.subarray(Math.max(localStart, 3), localEnd);
      } else {
        lineBytes = buffer.subarray(localStart, localEnd);
      }

      // Decode and try to parse
      const text = decoder.decode(lineBytes);
      try {
        JSON.parse(text);
      } catch {
        unparseable.push(lineIdx);
      }

      lineIdx++;
    }

    // Trim processed bytes from buffer
    if (lineIdx > 0 && lineIdx <= lineCount) {
      const lastProcessedEnd = lineIdx < lineCount ? ends[lineIdx - 1] : ends[lineCount - 1];
      const trimPoint = lastProcessedEnd - bufferStart;
      if (trimPoint > 0 && trimPoint <= buffer.length) {
        buffer = buffer.subarray(trimPoint);
        bufferStart = lastProcessedEnd;
      }
    }

    if (done) break;
  }

  return Uint32Array.from(unparseable);
}
