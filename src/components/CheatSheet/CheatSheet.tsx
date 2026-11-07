/**
 * Cheat sheet dialog showing hotkey table.
 * WP 6a: Rendered from shared HOTKEY_TABLE constant.
 * WP 6b: grouped by each entry's group, the panel keys included.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HOTKEY_GROUPS, HOTKEY_TABLE } from '../../lib/hotkeyTable';

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
  // Every entry names its group, so every §2.2 key appears exactly once
  const renderGroup = (title: string, keys: typeof HOTKEY_TABLE) => (
    <div className="mb-4" key={title}>
      <h3 className="label text-neutral-11 mb-2">{title}</h3>
      <div className="grid gap-1">
        {keys.map((entry) => (
          <div
            key={entry.key}
            className="flex items-center justify-between gap-4 text-chrome"
            data-hotkey={entry.key}
          >
            <span className="text-neutral-12">
              {entry.description}
              {entry.modes.length === 1 && entry.modes[0] === 'compare' && (
                <span className="ml-1 text-neutral-11">(compare mode)</span>
              )}
            </span>
            {/* Keycaps: text-chrome on neutral-3 in a neutral-7 border (§2.11 screen 8) */}
            <kbd className="rounded-control border border-neutral-7 bg-neutral-3 px-2 py-1 text-chrome text-neutral-12 whitespace-nowrap">
              {formatKey(entry.key)}
              {entry.altKey && (
                <span className="text-neutral-11">
                  {' '}
                  / {formatKey(entry.altKey)}
                </span>
              )}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-dialog sheet-max overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="mt-4">
          {HOTKEY_GROUPS.map((group) =>
            renderGroup(
              group,
              HOTKEY_TABLE.filter((h) => h.group === group)
            )
          )}
        </div>
        <div className="mt-4 text-chrome text-neutral-11 text-center">
          Press ? to toggle this dialog
        </div>
      </DialogContent>
    </Dialog>
  );
}
