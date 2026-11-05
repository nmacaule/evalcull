/**
 * Download the current session as {sourceName}.evalcull.json (PRD §2.7). Once
 * the download is handed to the browser, the store's per-file unsaved mark is
 * cleared, so a switch the user cancelled for unsaved changes can go ahead
 * (DR-001 refinement 1).
 */

import { useReviewStore } from '../store/useReviewStore';
import { downloadBlob } from './download';

export function downloadSession(): void {
  const store = useReviewStore.getState();
  const text = store.exportSession();
  downloadBlob(new Blob([text], { type: 'application/json' }), `${store.sourceName}.evalcull.json`);
  store.noteSessionDownloaded();
}
