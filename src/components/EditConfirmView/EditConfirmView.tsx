/**
 * Edit confirmation view showing original vs edited side-by-side.
 * WP 6a decision (i): user confirms or discards edit with arrow keys.
 * WP 6b: the two values as a line diff (PRD §2.5).
 * WP 7b (PRD §2.11 screen 6): original left and edited right as in compare
 * mode, each its side of the diff; keycaps on neutral-3 in a neutral-7 border;
 * Keep is the screen's one primary action.
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

const KEYCAP = 'rounded-control border border-neutral-7 bg-neutral-3 px-1 text-chrome text-neutral-12';

export function EditConfirmView({
  originalValue,
  editedValue,
  onKeep,
  onDiscard,
  onDismiss,
}: EditConfirmViewProps) {
  return (
    <div data-screen="confirmation" className="min-h-screen bg-neutral-1 text-neutral-12 p-8">
      <div className="max-w-confirm mx-auto">
        <h2 className="text-heading font-semibold mb-4">Confirm Edit</h2>
        <p className="text-chrome text-neutral-11 mb-4">
          Press <kbd className={KEYCAP}>{'\u2192'}</kbd> to
          keep the edit, <kbd className={KEYCAP}>{'\u2190'}</kbd>{' '}
          to discard, or <kbd className={KEYCAP}>Esc</kbd> to
          dismiss.
        </p>
        <div className="grid grid-cols-2 gap-6">
          <section aria-label="Original" className="flex flex-col gap-2 rounded-panel bg-neutral-2 p-4">
            <div className="label text-neutral-11">Original</div>
            <DiffView original={originalValue} edited={editedValue} side="original" />
          </section>
          <section aria-label="Edited" className="flex flex-col gap-2 rounded-panel bg-neutral-2 p-4">
            <div className="label text-neutral-11">Edited</div>
            <DiffView original={originalValue} edited={editedValue} side="edited" />
          </section>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={onKeep}>
            Keep Edit ({'\u2192'})
          </Button>
          <Button variant="secondary" onClick={onDiscard}>
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
