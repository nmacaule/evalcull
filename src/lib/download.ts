/**
 * Save a Blob under a file name in the browser: an object URL and a clicked
 * anchor, revoked afterwards. No network request is made (PRD §2.9).
 */

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
