/**
 * The hotkeys a test drives: every HOTKEY_TABLE entry that is not a no-op.
 * Kept with the tests, since application code never needs it (D-061).
 */

import { HOTKEY_TABLE, type HotkeyEntry } from '../../src/lib/hotkeyTable';

export function getTestableHotkeys(): HotkeyEntry[] {
  return HOTKEY_TABLE.filter((entry) => !entry.isNoOp);
}
