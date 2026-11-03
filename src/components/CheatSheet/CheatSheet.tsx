/**
 * Cheat sheet dialog showing hotkey table.
 * WP 6a: Rendered from shared HOTKEY_TABLE constant.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HOTKEY_TABLE } from '../../lib/hotkeyTable';

export interface CheatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatKey(key: string): string {
  // Format mod key based on platform
  if (key.toLowerCase().includes('mod')) {
    const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
    return key.replace(/mod/gi, isMac ? '\u2318' : 'Ctrl');
  }
  // Format special keys
  return key
    .replace('ArrowLeft', '\u2190')
    .replace('ArrowRight', '\u2192')
    .replace('ArrowUp', '\u2191')
    .replace('ArrowDown', '\u2193')
    .replace('Escape', 'Esc')
    .replace('Shift+', '\u21E7');
}

export function CheatSheet({ open, onOpenChange }: CheatSheetProps) {
  // Group hotkeys by category
  const preferenceKeys = HOTKEY_TABLE.filter(
    (h) => h.action === 'prefer' || h.action === 'setStrength'
  );
  const decisionKeys = HOTKEY_TABLE.filter((h) => h.action === 'decide');
  const navigationKeys = HOTKEY_TABLE.filter((h) =>
    ['next', 'prev', 'toggleFocus', 'scrollUp', 'scrollDown'].includes(h.action)
  );
  const editKeys = HOTKEY_TABLE.filter((h) =>
    ['openEditor', 'saveEditor', 'cancelEditor'].includes(h.action)
  );
  const viewKeys = HOTKEY_TABLE.filter((h) =>
    ['toggleRaw', 'toggleWhitespace', 'cycleFilter', 'showCheatSheet'].includes(
      h.action
    )
  );
  const historyKeys = HOTKEY_TABLE.filter((h) =>
    ['undo', 'redo'].includes(h.action)
  );

  const renderGroup = (title: string, keys: typeof HOTKEY_TABLE) => (
    <div className="mb-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="grid gap-1">
        {keys.map((entry) => (
          <div
            key={entry.key}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-muted-foreground">{entry.description}</span>
            <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
              {formatKey(entry.key)}
              {entry.altKey && (
                <span className="text-muted-foreground">
                  {' '}
                  / {formatKey(entry.altKey)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          {renderGroup('Preferences (Compare Mode)', preferenceKeys)}
          {renderGroup('Decisions', decisionKeys)}
          {renderGroup('Navigation', navigationKeys)}
          {renderGroup('Editing', editKeys)}
          {renderGroup('View', viewKeys)}
          {renderGroup('History', historyKeys)}
        </div>
        <div className="mt-4 text-xs text-muted-foreground text-center">
          Press ? to toggle this dialog
        </div>
      </DialogContent>
    </Dialog>
  );
}
