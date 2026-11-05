/**
 * Store types for WP 3.
 */

/**
 * A parsed record with its index, parse status, and data.
 * Named in §3.5 record(i), defined here.
 */
export type ParsedRecord =
  | { index: number; ok: true; data: unknown } // may contain LosslessNumber
  | { index: number; ok: false; error: string; raw: string };

/**
 * Storage state exposed to the UI.
 */
export type StorageState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; message: string }
  // A file switch was cancelled because the current file's changes could not be saved (D-041)
  | { kind: 'not-saved'; message: string };

/**
 * Session load outcome exposed to the UI.
 */
export type SessionOutcome =
  | { kind: 'fresh' }
  | { kind: 'restored' }
  | {
      kind: 'refused';
      // superseded: the file or session changed during one of the import's waits (D-042);
      // switching: another switch was opening, one at a time (DR-001);
      // regroup-failed: re-grouping for the session's format failed (D-076)
      reason: 'fingerprint-mismatch' | 'unknown-version' | 'invalid-session' | 'superseded' | 'switching' | 'regroup-failed';
      message: string;
      // The name importSession was given, on its parse, version and fingerprint
      // refusals of a session file, kept beside the request (owner, D-088); absent on
      // every other refusal and at load. Load anyway is decided by the request, not
      // the name (D-087, D-088)
      name?: string;
      // The caller's object for the one load it refused, on the same three refusals:
      // a name does not identify a load, two session files can share one (D-088);
      // absent on every other refusal and at load
      request?: object;
    };

/**
 * The store-owned file switch (PRD §3.5, DR-001): load(), importSession(),
 * applyNewerLocalCopy() and setFormat() run one at a time; the app reads it
 * for "a file is opening" at every entry point.
 */
export type SwitchState = { kind: 'idle' } | { kind: 'opening'; name: string };

/**
 * Edit values are written and read with lossless-json.
 * May contain LosslessNumber for unsafe integers.
 */
export type EditValue = unknown;
