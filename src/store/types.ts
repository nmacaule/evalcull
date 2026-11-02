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
  | { kind: 'error'; message: string };

/**
 * Session load outcome exposed to the UI.
 */
export type SessionOutcome =
  | { kind: 'fresh' }
  | { kind: 'restored' }
  | {
      kind: 'refused';
      reason: 'fingerprint-mismatch' | 'unknown-version' | 'invalid-session';
      message: string;
    };

/**
 * Edit values are written and read with lossless-json.
 * May contain LosslessNumber for unsafe integers.
 */
export type EditValue = unknown;
