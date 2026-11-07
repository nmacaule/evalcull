/**
 * Opening a file (PRD §2.1 drag-and-drop, §3.9 "drag-and-drop in"): a drop
 * anywhere on the window or the Open file button, through the shared
 * loadJsonlFile (D-004). The window listeners prevent the browser's default,
 * which would navigate away to the dropped file. With a file already open a
 * drop asks first (owner Q1, 4 Nov 2026); load() saves the current file's
 * pending changes before switching (D-029, PRD §2.7). App keeps it mounted on
 * every screen while a file is open, and passes a reason while a drop must be
 * refused, such as an open edit that the switch would lose (D-033). The
 * switch itself is the store's (DR-001): the Dropzone reserves it before the
 * file is read, and a drop while any switch is opening is refused.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { loadJsonlFile } from '../../readers/loadJsonlFile';
import { SAMPLES, sampleFile } from '../../lib/samples';
import { useReviewStore } from '../../store/useReviewStore';
import { AlertText } from '../StatusMark';
import { FixedOverlay } from '../FixedOverlay';

export interface DropzoneProps {
  /** A file is open: render only the drop confirm, not the empty page */
  loaded: boolean;
  /** Told when the drop confirm opens or closes, so hotkeys pause */
  onConfirmOpenChange?: (open: boolean) => void;
  /** While set, a drop is refused with this message (D-033) */
  blockedReason?: string | null;
}

export function Dropzone({ loaded, onConfirmOpenChange, blockedReason }: DropzoneProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Wait for {name} to open.: the one place a refused request is reported (D-056)
  const notice = useReviewStore((s) => s.switchNotice);
  const message = notice ?? error;

  const open = useCallback(
    async (file: File) => {
      // The switch is held from here, through the read, to the store's load() (DR-001);
      // refused, the store's notice says why (D-056)
      if (!useReviewStore.getState().beginOpening(file.name)) return;
      setIsLoading(true);
      setError(null);
      setProgress({ loaded: 0, total: file.size });
      try {
        await loadJsonlFile(file, (bytes, total) => setProgress({ loaded: bytes, total }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        useReviewStore.getState().endOpening();
        setIsLoading(false);
        setProgress(null);
      }
    },
    []
  );

  const accept = useCallback(
    (files: FileList | File[] | null | undefined) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      // One switch at a time: a drop while any switch is opening is refused,
      // and the store's notice says so (D-039, DR-001, D-056)
      if (useReviewStore.getState().refuseWhileOpening()) {
        setError(null);
        return;
      }
      if (blockedReason) {
        setError(blockedReason);
        return;
      }
      if (list.length > 1) {
        setError('Drop one file at a time.');
        return;
      }
      const [file] = list;
      if (!file.name.toLowerCase().endsWith('.jsonl')) {
        setError('Only .jsonl files open in this version.');
        return;
      }
      setError(null);
      if (loaded) {
        setPending(file);
        onConfirmOpenChange?.(true);
      } else {
        open(file);
      }
    },
    [loaded, open, onConfirmOpenChange, blockedReason]
  );

  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      accept(e.dataTransfer?.files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [accept]);

  const closeConfirm = () => {
    setPending(null);
    onConfirmOpenChange?.(false);
  };

  const confirm = (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && closeConfirm()}>
      <DialogContent className="max-w-dropzone">
        <DialogHeader>
          <DialogTitle>Open another file</DialogTitle>
          <DialogDescription>
            Open {pending?.name}? Changes to the current file are saved first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={closeConfirm}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const file = pending;
              closeConfirm();
              if (file) open(file);
            }}
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (loaded) {
    return (
      <>
        {confirm}
        {(message || isLoading) && (
          // One live region per state: status while opening, the message's own alert otherwise
          <FixedOverlay
            side="bottom"
            role={message ? undefined : 'status'}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-panel border border-neutral-6 bg-neutral-2 px-4 py-2 text-chrome text-neutral-12"
          >
            {message ? <AlertText>{message}</AlertText> : 'Opening…'}
          </FixedOverlay>
        )}
      </>
    );
  }

  return (
    <div data-screen="empty" className="min-h-screen bg-neutral-1 text-neutral-12 flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-heading font-semibold">evalcull</h1>
      <p className="text-chrome text-neutral-11">Drop a JSONL file anywhere on this page, or open one.</p>
      {/* The drop target (§2.11 screen 1): bordered in neutral-9 at radius 6 */}
      <div className="flex flex-col items-center gap-4 rounded-panel border border-neutral-9 p-8">
        <Button variant="secondary" disabled={isLoading} onClick={() => input.current?.click()}>
          {isLoading ? (
            <>
              Loading...
              {progress && progress.total > 0 && (
                <span className="ml-2" data-numeric>{Math.round((progress.loaded / progress.total) * 100)}%</span>
              )}
            </>
          ) : (
            'Open file'
          )}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".jsonl"
          className="hidden"
          aria-label="JSONL file"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = '';
          }}
          disabled={isLoading}
        />
        {/* The embedded samples open through the same checks as a drop (DR-010) */}
        {/* The candidates sample is the screen's one primary action (DR-019) */}
        <div className="flex flex-wrap justify-center gap-2">
          {SAMPLES.map((sample) => (
            <Button
              key={sample.name}
              variant={sample.label === 'candidates' ? 'primary' : 'secondary'}
              size="sm"
              disabled={isLoading}
              onClick={() => accept([sampleFile(sample)])}
            >
              Open sample: {sample.label}
            </Button>
          ))}
        </div>
      </div>
      {message && <AlertText>{message}</AlertText>}
    </div>
  );
}
