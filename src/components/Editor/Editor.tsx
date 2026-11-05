/**
 * Textarea editor for a single field.
 * WP 6a: Mod+Enter saves, Esc cancels.
 * WP 6b: shows a save error (D-018); on a conversation, ↑ at the start or ↓ at
 * the end switches assistant turns while the text is unchanged (D-019), so
 * nothing typed is discarded and ↑/↓ otherwise move the caret.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface EditorProps {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  /** Shown under the textarea when a save was refused, e.g. invalid JSON */
  error?: string | null;
  /** Previous/next assistant turn, for a conversation candidate */
  turnSwitch?: { onPrev: () => void; onNext: () => void };
}

export function Editor({ initialValue, onSave, onCancel, error, turnSwitch }: EditorProps) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
    // Move cursor to end
    textareaRef.current?.setSelectionRange(
      textareaRef.current.value.length,
      textareaRef.current.value.length
    );
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Mod+Enter to save
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSave(value);
        return;
      }
      // Escape to cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      // Turn switch at the text's edges, only while nothing has been typed
      if (turnSwitch && value === initialValue && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        const { selectionStart, selectionEnd } = e.currentTarget;
        if (e.key === 'ArrowUp' && selectionStart === 0 && selectionEnd === 0) {
          e.preventDefault();
          turnSwitch.onPrev();
        } else if (e.key === 'ArrowDown' && selectionStart === value.length && selectionEnd === value.length) {
          e.preventDefault();
          turnSwitch.onNext();
        }
      }
    },
    [value, initialValue, onSave, onCancel, turnSwitch]
  );

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-[200px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Edit content"
      />
      {error && (
        <div className="text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 text-xs text-muted-foreground">
        {turnSwitch && (
          <span>↑ at the start or ↓ at the end switches assistant turns while the text is unchanged.</span>
        )}
        <span>Mod+Enter to save</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  );
}
