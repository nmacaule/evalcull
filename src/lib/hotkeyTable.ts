/**
 * Shared hotkey table for WP 6a.
 * Used by useHotkeys hook, CheatSheet dialog, and tests.
 * Oracle: PRD §2.2 transcribed.
 */

export type HotkeyMode = 'compare' | 'single' | 'both';

export interface HotkeyEntry {
  /** Key or key combo (e.g., 'ArrowLeft', 'Shift+1', 'mod+enter') */
  key: string;
  /** Alternative key if any (e.g., '1' as alt for ArrowLeft) */
  altKey?: string;
  /** Description shown in cheat sheet */
  description: string;
  /** Store action name or special action like 'openEditor' */
  action: string;
  /** Arguments to pass to the action */
  args?: unknown[];
  /** Mode(s) where this hotkey applies */
  modes: HotkeyMode[];
  /** Whether this fires with focus inside a form field (input/textarea) */
  firesInForm: boolean;
  /** Whether this is a 6b no-op (excluded from keyboard tests) */
  isNoOp?: boolean;
}

/**
 * Complete hotkey table transcribed from PRD §2.2.
 * Sorted by logical grouping.
 */
export const HOTKEY_TABLE: HotkeyEntry[] = [
  // Preference keys (compare mode only)
  {
    key: 'ArrowLeft',
    altKey: '1',
    description: 'Prefer left candidate and go to the next pair',
    action: 'prefer',
    args: ['left'],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'ArrowRight',
    altKey: '2',
    description: 'Prefer right candidate and go to the next pair',
    action: 'prefer',
    args: ['right'],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: '=',
    altKey: '0',
    description: 'Tie (both acceptable)',
    action: 'prefer',
    args: ['tie'],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'x',
    description: 'Both unacceptable',
    action: 'prefer',
    args: ['both_bad'],
    modes: ['compare'],
    firesInForm: false,
  },
  // Preference strength (compare mode only)
  {
    key: 'Shift+1',
    description: 'Preference strength 1 (significantly better) for the pair just judged',
    action: 'setStrength',
    args: [1],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'Shift+2',
    description: 'Preference strength 2 (better) for the pair just judged',
    action: 'setStrength',
    args: [2],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'Shift+3',
    description: 'Preference strength 3 (slightly better) for the pair just judged',
    action: 'setStrength',
    args: [3],
    modes: ['compare'],
    firesInForm: false,
  },
  // Decision keys (both modes)
  {
    key: 'a',
    description: 'Keep focused candidate',
    action: 'decide',
    args: ['kept'],
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'r',
    description: 'Reject focused candidate',
    action: 'decide',
    args: ['rejected'],
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 's',
    description: 'Skip focused candidate',
    action: 'decide',
    args: ['skipped'],
    modes: ['both'],
    firesInForm: false,
  },
  // Focus and navigation
  {
    key: 'Tab',
    description: 'Toggle focus between candidates',
    action: 'toggleFocus',
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'j',
    description: 'Next prompt',
    action: 'next',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'k',
    description: 'Previous prompt',
    action: 'prev',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'ArrowUp',
    description: 'Scroll card / select turn',
    action: 'scrollUp',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'ArrowDown',
    description: 'Scroll card / select turn',
    action: 'scrollDown',
    modes: ['both'],
    firesInForm: false,
  },
  // Edit
  {
    key: 'e',
    description: 'Edit focused candidate',
    action: 'openEditor',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'mod+enter',
    description: 'Save and close editor',
    action: 'saveEditor',
    modes: ['both'],
    firesInForm: true,
  },
  {
    key: 'Escape',
    description: 'Cancel / close editor',
    action: 'cancelEditor',
    modes: ['both'],
    firesInForm: true,
  },
  // Undo/redo
  {
    key: 'u',
    description: 'Undo',
    action: 'undo',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'Shift+u',
    description: 'Redo',
    action: 'redo',
    modes: ['both'],
    firesInForm: false,
  },
  // View toggles
  {
    key: 't',
    description: 'Toggle raw view',
    action: 'toggleRaw',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'w',
    description: 'Toggle whitespace reveal',
    action: 'toggleWhitespace',
    modes: ['both'],
    firesInForm: false,
  },
  // Filter and cheat sheet (wired in 6a)
  {
    key: 'f',
    description: 'Cycle filter',
    action: 'cycleFilter',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: '?',
    description: 'Show cheat sheet',
    action: 'showCheatSheet',
    modes: ['both'],
    firesInForm: false,
  },
  // Panel hotkeys (6b no-ops)
  {
    key: 'm',
    description: 'Toggle metadata panel',
    action: 'toggleMetadata',
    modes: ['both'],
    firesInForm: false,
    isNoOp: true,
  },
  {
    key: 'l',
    description: 'Open label panel',
    action: 'openLabels',
    modes: ['both'],
    firesInForm: false,
    isNoOp: true,
  },
  {
    key: 'n',
    description: 'Open notes panel',
    action: 'openNotes',
    modes: ['both'],
    firesInForm: false,
    isNoOp: true,
  },
  {
    key: 'g',
    description: 'Go to prompt',
    action: 'goToPrompt',
    modes: ['both'],
    firesInForm: false,
    isNoOp: true,
  },
  {
    key: '/',
    description: 'Search',
    action: 'search',
    modes: ['both'],
    firesInForm: false,
    isNoOp: true,
  },
];

/**
 * Get hotkeys applicable to a specific mode.
 */
export function getHotkeysForMode(mode: 'compare' | 'single'): HotkeyEntry[] {
  return HOTKEY_TABLE.filter(
    (entry) => entry.modes.includes(mode) || entry.modes.includes('both')
  );
}

/**
 * Get hotkeys that should be tested (excludes 6b no-ops).
 */
export function getTestableHotkeys(): HotkeyEntry[] {
  return HOTKEY_TABLE.filter((entry) => !entry.isNoOp);
}
