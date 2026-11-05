/**
 * Edit confirmation view showing original vs edited side-by-side.
 * WP 6a decision (i): user confirms or discards edit with arrow keys.
 * WP 6b: the two values as a line diff (PRD §2.5).
 */

import { Button } from '@/components/ui/button';
import { DiffView } from '../DiffView';

export interface EditConfirmViewProps {
  originalValue: string;
  editedValue: string;
  onKeep: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
}

export function EditConfirmView({
  originalValue,
  editedValue,
  onKeep,
  onDiscard,
  onDismiss,
}: EditConfirmViewProps) {
  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-lg font-semibold mb-4">Confirm Edit</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Press <kbd className="px-1 py-0.5 bg-muted rounded">{'\u2192'}</kbd> to
          keep the edit, <kbd className="px-1 py-0.5 bg-muted rounded">{'\u2190'}</kbd>{' '}
          to discard, or <kbd className="px-1 py-0.5 bg-muted rounded">Esc</kbd> to
          dismiss.
        </p>
        <DiffView original={originalValue} edited={editedValue} />

        <div className="mt-4 flex gap-2">
          <Button onClick={onKeep}>
            Keep Edit ({'\u2192'})
          </Button>
          <Button variant="outline" onClick={onDiscard}>
            Discard ({'\u2190'})
          </Button>
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss (Esc)
          </Button>
        </div>
      </div>
    </div>
  );
}
