/**
 * The status pattern (PRD §2.11, O12): a word and a 6 px dot in one colour on
 * the neutral surface, never colour alone and never a tinted background. Kept,
 * rejected, edited and preferred use their status colour; skipped, tie, both
 * bad and every warning or informational badge use neutral-11; an error is the
 * word and dot in status-rejected (DR-017). Unreviewed shows nothing.
 */

import type React from 'react';

export type StatusTone = 'kept' | 'rejected' | 'edited' | 'preferred' | 'quiet' | 'error';

const TONE: Record<StatusTone, string> = {
  kept: 'text-status-kept',
  rejected: 'text-status-rejected',
  edited: 'text-status-edited',
  preferred: 'text-status-preferred',
  quiet: 'text-neutral-11',
  error: 'text-status-rejected',
};

export interface StatusMarkProps {
  tone: StatusTone;
  /** The word shown, and the data-status value */
  word: string;
  className?: string;
}

export function StatusMark({ tone, word, className }: StatusMarkProps) {
  return (
    <span
      data-status={word}
      className={`inline-flex items-center gap-1 text-chrome font-medium ${TONE[tone]}${className ? ` ${className}` : ''}`}
    >
      <span className="status-dot" aria-hidden="true" />
      {word}
    </span>
  );
}

/**
 * An error (DR-017): its message as the word, with the dot, in status-rejected,
 * announced through role="alert".
 */
export function AlertText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      data-status="error"
      className={`flex items-center gap-2 text-chrome text-status-rejected${className ? ` ${className}` : ''}`}
    >
      <span className="status-dot" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The tone of a decision status, or null for unreviewed (§2.11 Status pattern). */
export function statusTone(status: string | undefined): StatusTone | null {
  switch (status) {
    case 'kept':
      return 'kept';
    case 'rejected':
      return 'rejected';
    case 'skipped':
      return 'quiet';
    default:
      return null;
  }
}
