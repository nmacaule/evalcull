/**
 * Shared hotkey table for WP 6a.
 * Used by useHotkeys hook, CheatSheet dialog, and tests.
 * Oracle: PRD §2.2 transcribed.
 * WP 6b: the panel keys are live, and every entry names its cheat-sheet group,
 * so no entry can be left out of the sheet.
 */

export type HotkeyMode = 'compare' | 'single' | 'both';

export type HotkeyGroup =
  | 'Preferences'
  | 'Decisions'
  | 'Navigation'
  | 'Editing'
  | 'History'
  | 'View'
  | 'Panels';

export const HOTKEY_GROUPS: HotkeyGroup[] = [
  'Preferences',
  'Decisions',
  'Navigation',
  'Editing',
  'History',
  'View',
  'Panels',
];

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
  /** Cheat-sheet group */
  group: HotkeyGroup;
  /** Whether this is a no-op not yet built (excluded from keyboard tests) */
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
    group: 'Preferences',
    args: ['left'],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'ArrowRight',
    altKey: '2',
    description: 'Prefer right candidate and go to the next pair',
    action: 'prefer',
    group: 'Preferences',
    args: ['right'],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: '=',
    altKey: '0',
    description: 'Tie (both acceptable)',
    action: 'prefer',
    group: 'Preferences',
    args: ['tie'],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'x',
    description: 'Both unacceptable',
    action: 'prefer',
    group: 'Preferences',
    args: ['both_bad'],
    modes: ['compare'],
    firesInForm: false,
  },
  // Preference strength (compare mode only)
  {
    key: 'Shift+1',
    description: 'Preference strength 1 (significantly better) for the pair just judged',
    action: 'setStrength',
    group: 'Preferences',
    args: [1],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'Shift+2',
    description: 'Preference strength 2 (better) for the pair just judged',
    action: 'setStrength',
    group: 'Preferences',
    args: [2],
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'Shift+3',
    description: 'Preference strength 3 (slightly better) for the pair just judged',
    action: 'setStrength',
    group: 'Preferences',
    args: [3],
    modes: ['compare'],
    firesInForm: false,
  },
  // Decision keys (both modes)
  {
    key: 'a',
    description: 'Keep focused candidate',
    action: 'decide',
    group: 'Decisions',
    args: ['kept'],
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'r',
    description: 'Reject focused candidate',
    action: 'decide',
    group: 'Decisions',
    args: ['rejected'],
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 's',
    description: 'Skip focused candidate',
    action: 'decide',
    group: 'Decisions',
    args: ['skipped'],
    modes: ['both'],
    firesInForm: false,
  },
  // Focus and navigation
  {
    key: 'Tab',
    description: 'Toggle focus between candidates',
    action: 'toggleFocus',
    group: 'Navigation',
    modes: ['compare'],
    firesInForm: false,
  },
  {
    key: 'j',
    description: 'Next prompt (record in single mode)',
    action: 'next',
    group: 'Navigation',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'k',
    description: 'Previous prompt (record in single mode)',
    action: 'prev',
    group: 'Navigation',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'ArrowUp',
    description:
      'Scroll the focused card; in the editor, ↑ at the start or ↓ at the end switches assistant turns while the text is unchanged',
    action: 'scrollUp',
    group: 'Navigation',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'ArrowDown',
    description: 'Scroll the focused card',
    action: 'scrollDown',
    group: 'Navigation',
    modes: ['both'],
    firesInForm: false,
  },
  // Edit
  {
    key: 'e',
    description: 'Edit focused candidate',
    action: 'openEditor',
    group: 'Editing',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'mod+enter',
    description: 'Save and close editor',
    action: 'saveEditor',
    group: 'Editing',
    modes: ['both'],
    firesInForm: true,
  },
  {
    key: 'Escape',
    description: 'Cancel / close editor',
    action: 'cancelEditor',
    group: 'Editing',
    modes: ['both'],
    firesInForm: true,
  },
  // Undo/redo
  {
    key: 'u',
    description: 'Undo',
    action: 'undo',
    group: 'History',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'Shift+u',
    description: 'Redo',
    action: 'redo',
    group: 'History',
    modes: ['both'],
    firesInForm: false,
  },
  // View toggles
  {
    key: 't',
    description: 'Toggle raw view',
    action: 'toggleRaw',
    group: 'View',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'w',
    description: 'Toggle whitespace reveal',
    action: 'toggleWhitespace',
    group: 'View',
    modes: ['both'],
    firesInForm: false,
  },
  // The reading step (PRD §2.2, §2.11, DR-016 O7): view state, never saved
  {
    key: 'z',
    description: 'Reading step: content 14 px or 16 px',
    action: 'toggleReadingStep',
    group: 'View',
    modes: ['both'],
    firesInForm: false,
  },
  // Filter and cheat sheet (wired in 6a)
  {
    key: 'f',
    description: 'Cycle filter',
    action: 'cycleFilter',
    group: 'View',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: '?',
    description: 'Show cheat sheet',
    action: 'showCheatSheet',
    group: 'View',
    modes: ['both'],
    firesInForm: false,
  },
  // Panel hotkeys (WP 6b)
  {
    key: 'm',
    description: 'Toggle metadata panel',
    action: 'toggleMetadata',
    group: 'Panels',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'l',
    description: 'Label and score panel',
    action: 'openLabels',
    group: 'Panels',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'n',
    description: 'Notes panel',
    action: 'openNotes',
    group: 'Panels',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: 'g',
    description: 'Go to a prompt; Enter on an empty field goes to the next unreviewed',
    action: 'goToPrompt',
    group: 'Panels',
    modes: ['both'],
    firesInForm: false,
  },
  {
    key: '/',
    description: "Search the file's raw text",
    action: 'search',
    group: 'Panels',
    modes: ['both'],
    firesInForm: false,
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
 * The table's keys that are not character keys under WCAG 2.2 SC 2.1.4, spelled as the
 * entries above spell them: the single-key switch leaves these on (DR-029)
 */
const NON_CHARACTER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'mod+enter']);

/** Whether a HOTKEY_TABLE key relies on a printable character, so the single-key switch turns it off (DR-029) */
export function isCharacterKey(key: string): boolean {
  return !NON_CHARACTER_KEYS.has(key);
}
