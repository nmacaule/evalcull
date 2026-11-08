/**
 * Browser preferences, kept in local storage for this page and never in the session
 * (PRD §2.7 v3.6; DR-029, DR-030). A storage that is absent or throws (an opaque
 * origin throws SecurityError, HTML §12.2.3) leaves the defaults: single-key
 * shortcuts on, and every first-use hint treated as seen.
 */

const SHORTCUTS_KEY = 'evalcull.shortcuts';
const HINTS_KEY = 'evalcull.hints';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether single-key shortcuts are on (DR-029); on unless turned off. */
export function readCharacterKeys(): boolean {
  try {
    return storage()?.getItem(SHORTCUTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeCharacterKeys(on: boolean): void {
  try {
    storage()?.setItem(SHORTCUTS_KEY, on ? 'on' : 'off');
  } catch {
    // The switch still holds for this page; it is not kept
  }
}

function readHints(): string[] | null {
  try {
    const s = storage();
    if (!s) return null;
    const parsed: unknown = JSON.parse(s.getItem(HINTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : [];
  } catch {
    return null;
  }
}

/** Whether a first-use hint has been shown and dismissed (DR-030); a storage failure counts as seen. */
export function hintSeen(id: string): boolean {
  const seen = readHints();
  return seen === null || seen.includes(id);
}

export function markHintSeen(id: string): void {
  try {
    const seen = readHints() ?? [];
    if (!seen.includes(id)) storage()?.setItem(HINTS_KEY, JSON.stringify([...seen, id]));
  } catch {
    // Not kept; the hint goes for this page
  }
}
