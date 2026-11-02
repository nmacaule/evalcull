/**
 * Compute a SHA-256 fingerprint for a file.
 *
 * Takes name, size, and lastModified as arguments rather than a File,
 * because launcher mode uses /api/meta.mtimeMs and the widget uses
 * a different scheme entirely.
 */
export async function fingerprint(
  name: string,
  size: number,
  lastModified: number
): Promise<string> {
  const input = `${name}:${size}:${lastModified}`;
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
