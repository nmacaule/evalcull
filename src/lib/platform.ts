/**
 * Key names for the user's platform (PRD §2.2 v3.6, DR-035 as amended 7 Nov 2026).
 * Apple platforms show ⌘ Return and ⇧ (Apple's own names; Firefox spells Return on the Mac
 * and Enter elsewhere); every other platform shows Ctrl+Enter and Shift+. aria-keyshortcuts
 * always uses the UI Events key values: Meta, Control, Shift, Enter.
 */

/** Apple platforms, by navigator.platform, the check the cheat sheet has used since WP 6a */
export function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? '');
}

const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** A HOTKEY_TABLE key as the user sees it */
export function keyLabel(key: string): string {
  const apple = isApplePlatform();
  if (key === 'mod+enter') return apple ? '⌘ Return' : 'Ctrl+Enter';
  if (key in ARROWS) return ARROWS[key];
  if (key === 'Escape') return 'Esc';
  if (key.startsWith('Shift+')) {
    const rest = key.slice('Shift+'.length).toUpperCase();
    return apple ? `⇧${rest}` : `Shift+${rest}`;
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A HOTKEY_TABLE key as aria-keyshortcuts names it (WAI-ARIA 1.2, UI Events key values) */
export function keyShortcut(key: string): string {
  if (key === 'mod+enter') return isApplePlatform() ? 'Meta+Enter' : 'Control+Enter';
  if (key.startsWith('Shift+')) return `Shift+${key.slice('Shift+'.length).toUpperCase()}`;
  return key.length === 1 ? key.toUpperCase() : key;
}
