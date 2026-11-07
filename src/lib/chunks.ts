/**
 * The page's reads of a file's bytes (PRD §3.4 (1), v3.5, DR-025).
 *
 * In WebKit a worker of a page opened from file:// cannot read the page's
 * Blobs (D-100), while the page can, so the page reads the bytes and the
 * worker parses them.
 */

/** Bytes per read: 4 MiB (DR-025) */
export const CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Read a blob in order, one slice at a time; each chunk owns its own buffer,
 * so it can be transferred.
 */
export async function* readChunks(blob: Blob, chunkSize = CHUNK_SIZE): AsyncGenerator<Uint8Array> {
  for (let pos = 0; pos < blob.size; pos += chunkSize) {
    const end = Math.min(pos + chunkSize, blob.size);
    yield new Uint8Array(await blob.slice(pos, end).arrayBuffer());
  }
}
