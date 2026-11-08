/**
 * A first-use hint at the moment of need (PRD §2.11 v3.6, DR-030): one line of text-chrome
 * in neutral-11 above the cards with a Got it button. It is there when the screen appears,
 * so it is not a live region. The caller decides from the seen record whether it shows.
 */

import { Button } from '@/components/ui/button';

export interface FirstUseHintProps {
  text: string;
  onDismiss: () => void;
}

export function FirstUseHint({ text, onDismiss }: FirstUseHintProps) {
  return (
    <div className="mb-4 flex items-center justify-center gap-3 text-chrome text-neutral-11" data-hint>
      <span>{text}</span>
      <Button variant="secondary" size="sm" onClick={onDismiss}>
        Got it
      </Button>
    </div>
  );
}
