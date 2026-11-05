/**
 * Where the session's changes stand (owner Q6, 4 Nov 2026; PRD §2.7, §5
 * Persistence), always visible in the header. Idle is the state after a load,
 * before any save was attempted, so it claims nothing.
 */

import type { StorageState } from '../../store/types';
import { Button } from '@/components/ui/button';
import { useReviewStore } from '../../store/useReviewStore';
import { downloadSession } from '../../lib/sessionDownload';

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
  const tone =
    state.kind === 'error' || state.kind === 'unavailable' || state.kind === 'not-saved'
      ? 'text-destructive'
      : 'text-muted-foreground';
  // A switch cancelled for changes that reached no sink offers its two ways out (DR-001 B-i)
  const cancelled = useReviewStore((s) => s.cancelledSwitch);
  const opening = useReviewStore((s) => s.switching.kind === 'opening');
  return (
    <>
      <span role="status" className={`text-sm ${tone}`}>
        {storageText(state)}
      </span>
      {state.kind === 'not-saved' && cancelled && (
        <span className="inline-flex gap-2">
          <Button size="sm" variant="outline" onClick={downloadSession}>
            Download session
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={opening || !!blockedReason}
            onClick={() => useReviewStore.getState().openAnywayDiscarding()}
          >
            Open anyway, discarding changes
          </Button>
          {/* No switch starts while a draft is open; the drop's reason says why (DR-001 rule 6, D-064) */}
          {blockedReason && <span className="text-sm text-muted-foreground">{blockedReason}</span>}
        </span>
      )}
    </>
  );
}
