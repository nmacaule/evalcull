/**
 * Go to (PRD §2.2 G; §2.8 jump-to-unreviewed; owner Q4, 4 Nov 2026): Enter
 * with a number goes to that prompt (record in single mode); Enter on an
 * empty field goes to the next unreviewed.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useReviewStore } from '../../store/useReviewStore';
import { AlertText } from '../StatusMark';

export interface GoToDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'compare' | 'single';
  total: number;
}

export function GoToDialog({ open, onOpenChange, mode, total }: GoToDialogProps) {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const label = mode === 'compare' ? 'Go to prompt' : 'Go to record';

  const close = (next: boolean) => {
    if (!next) {
      setValue('');
      setMessage(null);
    }
    onOpenChange(next);
  };

  const submit = () => {
    const store = useReviewStore.getState();
    if (value.trim() === '') {
      store.nextUnreviewed();
      close(false);
      return;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > total) {
      setMessage(`Enter 1 to ${total.toLocaleString('en-US')}.`);
      return;
    }
    store.goTo(n - 1);
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-goto">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>Enter on an empty field goes to the next unreviewed.</DialogDescription>
        </DialogHeader>
        <input
          aria-label={mode === 'compare' ? 'Prompt number' : 'Record number'}
          type="number"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          className="rounded-control border border-neutral-9 bg-neutral-1 px-2 py-1 text-chrome text-neutral-12" data-numeric
        />
        {message && (
          <AlertText>{message}</AlertText>
        )}
      </DialogContent>
    </Dialog>
  );
}
