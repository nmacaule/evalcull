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
import { HOTKEY_GROUPS, HOTKEY_TABLE, isCharacterKey } from '../../lib/hotkeyTable';
import { keyLabel } from '../../lib/platform';

export interface CheatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Single-key shortcuts on (DR-029); the list holds the switch and shows which keys are off */
  characterKeys?: boolean;
  onCharacterKeysChange?: (on: boolean) => void;
}

// The platform's key names (DR-035); letters in capitals, as the action bar shows them (owner, 7 Nov 2026)
function formatKey(key: string): string {
  return keyLabel(key);
}

export function CheatSheet({ open, onOpenChange, characterKeys = true, onCharacterKeysChange }: CheatSheetProps) {
  // A key the switch has turned off is not shown, so no hint names a key that does nothing (DR-029)
  const live = (key: string) => characterKeys || !isCharacterKey(key);
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
            {live(entry.key) ? (
              <kbd className="rounded-control border border-neutral-7 bg-neutral-3 px-2 py-1 text-chrome text-neutral-12 whitespace-nowrap">
                {formatKey(entry.key)}
                {entry.altKey && live(entry.altKey) && (
                  <span className="text-neutral-11">
                    {' '}
                    / {formatKey(entry.altKey)}
                  </span>
                )}
              </kbd>
            ) : (
              <span className="text-neutral-11">off</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-dialog sheet-max overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        {/* WCAG 2.2 SC 2.1.4: the mechanism that turns the single-key shortcuts off (DR-029) */}
        <div className="mt-4 grid gap-1 text-chrome">
          <label className="flex items-center gap-2 text-neutral-12">
            <input
              type="checkbox"
              checked={characterKeys}
              onChange={(e) => onCharacterKeysChange?.(e.target.checked)}
            />
            Single-key shortcuts
          </label>
          <p className="text-neutral-11">
            When on, letters, numbers and symbols such as ? work as shortcuts. Arrows, Tab, Esc and {keyLabel('mod+enter')} always work.
          </p>
        </div>
        <div className="mt-4">
          {HOTKEY_GROUPS.map((group) =>
            renderGroup(
              group,
              HOTKEY_TABLE.filter((h) => h.group === group)
            )
          )}
        </div>
        <div className="mt-4 text-chrome text-neutral-11 text-center">
          {/* Not ?, which the single-key switch turns off (DR-033, D-111) */}
          Open this list with the Keyboard shortcuts button in the header; Esc closes it.
        </div>
      </DialogContent>
    </Dialog>
  );
}
