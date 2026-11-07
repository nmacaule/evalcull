/**
 * Label and notes panel (PRD §2.2 L / N): labels, a numeric score and notes
 * for the focused candidate. Mod+Enter or Save applies them through the
 * store's undoable setLabels, setScore and setNotes (PRD §2.5); Esc closes
 * without saving. Single-key hotkeys are off while it is open (PRD §3.10).
 */

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useReviewStore } from '../../store/useReviewStore';
import type { CandidateRef } from '../../types';

export interface LabelNotesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateRef: CandidateRef;
  /** The field focused when the panel opens: L labels, N notes */
  focusField: 'labels' | 'notes';
}

export function LabelNotesPanel({ open, onOpenChange, candidateRef, focusField }: LabelNotesPanelProps) {
  const [labels, setLabels] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [score, setScore] = useState('');
  const [notes, setNotes] = useState('');
  const labelsRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Start from the candidate's stored values each time the panel opens
  useEffect(() => {
    if (!open) return;
    const d = useReviewStore.getState().decisions.get(candidateRef);
    setLabels(d?.labels ?? []);
    setDraft('');
    setScore(d?.score === undefined ? '' : String(d.score));
    setNotes(d?.notes ?? '');
  }, [open, candidateRef]);

  const addDraft = () => {
    const label = draft.trim();
    if (label && !labels.includes(label)) setLabels([...labels, label]);
    setDraft('');
  };

  const save = () => {
    const store = useReviewStore.getState();
    const before = store.decisions.get(candidateRef);
    const pending = draft.trim();
    const nextLabels = pending && !labels.includes(pending) ? [...labels, pending] : labels;
    const nextScore = score.trim() === '' ? undefined : Number(score);
    const nextNotes = notes === '' ? undefined : notes;

    // Only changed fields are written, so undo walks back exactly what was set
    if ((before?.labels ?? []).join('\u0000') !== nextLabels.join('\u0000')) {
      store.setLabels(candidateRef, nextLabels);
    }
    if (before?.score !== nextScore && !(nextScore !== undefined && Number.isNaN(nextScore))) {
      store.setScore(candidateRef, nextScore);
    }
    if (before?.notes !== nextNotes) store.setNotes(candidateRef, nextNotes);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-panel-md"
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (focusField === 'notes' ? notesRef.current : labelsRef.current)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Labels and notes</DialogTitle>
          <DialogDescription>
            For {candidateRef}. Mod+Enter saves, Esc closes without saving.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-chrome">
          <label className="flex flex-col gap-1">
            <span className="label text-neutral-11">Labels</span>
            <div className="flex flex-wrap gap-1">
              {labels.map((l) => (
                <span key={l} className="flex items-center gap-1 rounded-control bg-neutral-3 px-2 py-1 text-neutral-12">
                  {l}
                  <button
                    type="button"
                    className="rounded-control px-1"
                    aria-label={`Remove label ${l}`}
                    onClick={() => setLabels(labels.filter((x) => x !== l))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              ref={labelsRef}
              aria-label="Labels"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === ',') {
                  e.preventDefault();
                  addDraft();
                } else if (e.key === 'Backspace' && draft === '' && labels.length) {
                  setLabels(labels.slice(0, -1));
                }
              }}
              className="rounded-control border border-neutral-9 bg-neutral-1 px-2 py-1 text-chrome text-neutral-12"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label text-neutral-11">Score</span>
            <input
              aria-label="Score"
              type="number"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="w-score rounded-control border border-neutral-9 bg-neutral-1 px-2 py-1 text-chrome text-neutral-12" data-numeric
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label text-neutral-11">Notes</span>
            <textarea
              ref={notesRef}
              aria-label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="field-min-sm rounded-control border border-neutral-9 bg-neutral-1 px-2 py-1 text-content text-neutral-12"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
