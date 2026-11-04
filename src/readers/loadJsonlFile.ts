/**
 * Load a JSONL file into the store: read it, then hand the source to load().
 * Shared by the file input today and by 6b's Dropzone.
 */

import { readJsonl } from './jsonl';
import { fingerprint } from '../lib/fingerprint';
import { loadStoredFormat } from '../store/persistence';
import { useReviewStore } from '../store/useReviewStore';

export async function loadJsonlFile(
  file: File,
  onProgress?: (bytes: number, total: number) => void
): Promise<void> {
  // A saved session's format goes to the reader, so the second pass groups
  // for it once instead of detecting and then regrouping on restore (D-004)
  const fp = await fingerprint(file.name, file.size, file.lastModified);
  const format = await loadStoredFormat(fp);

  const result = await readJsonl(file, file.name, file.size, file.lastModified, {
    onProgress,
    ...(format ? { format } : {}),
  });

  await useReviewStore.getState().load(
    result.source,
    {
      sourceName: file.name,
      fingerprint: result.source.index.fingerprint,
      format: result.format,
    },
    {
      regroup: result.regroup,
      dispose: result.dispose,
    }
  );
}
