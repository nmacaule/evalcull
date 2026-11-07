/**
 * Where the session's changes stand (owner Q6, 4 Nov 2026; PRD §2.7, §5
 * Persistence), always visible in the header. Idle is the state after a load,
 * before any save was attempted, so it claims nothing.
 * WP 7b: the state is a word and its dot (PRD §2.11 screen 2); a failed save,
 * storage off and changes not saved are errors, in status-rejected and announced
 * as an alert, and every other state is neutral-11 in a status region (DR-017).
 */

import type { StorageState } from '../../store/types';
import { Button } from '@/components/ui/button';
import { useReviewStore } from '../../store/useReviewStore';
import { downloadSession } from '../../lib/sessionDownload';
import { StatusMark } from '../StatusMark';

export function storageText(state: StorageState): string {
  switch (state.kind) {
    case 'saved':
      return 'Saved';
    case 'saving':
      return 'Saving…';
    case 'error':
      return `Save failed: ${state.message}`;
    case 'unavailable':
      return `Storage off: ${state.reason}`;
    case 'not-saved':
      return state.message;
    case 'idle':
    default:
      return 'No unsaved changes';
  }
}

export function StorageIndicator({ state, blockedReason }: { state: StorageState; blockedReason?: string | null }) {
  const failed = state.kind === 'error' || state.kind === 'unavailable' || state.kind === 'not-saved';
  // A switch cancelled for changes that reached no sink offers its two ways out (DR-001 B-i)
  const cancelled = useReviewStore((s) => s.cancelledSwitch);
  const opening = useReviewStore((s) => s.switching.kind === 'opening');
  return (
    <>
      <span role={failed ? 'alert' : 'status'}>
        <StatusMark tone={failed ? 'error' : 'quiet'} word={storageText(state)} />
      </span>
      {state.kind === 'not-saved' && cancelled && (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="secondary" onClick={downloadSession}>
            Download session
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={opening || !!blockedReason}
            onClick={() => useReviewStore.getState().openAnywayDiscarding()}
          >
            Open anyway, discarding changes
          </Button>
          {/* No switch starts while a draft is open; the drop's reason says why (DR-001 rule 6, D-064) */}
          {blockedReason && <span className="text-chrome text-neutral-11">{blockedReason}</span>}
        </span>
      )}
    </>
  );
}
