/**
 * Textarea editor for a single field.
 * WP 6a: Mod+Enter saves, Esc cancels.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface EditorProps {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

export function Editor({ initialValue, onSave, onCancel }: EditorProps) {
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
    },
    [value, onSave, onCancel]
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
      <div className="flex justify-end gap-2 text-xs text-muted-foreground">
        <span>Mod+Enter to save</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  );
}
