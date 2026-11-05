/**
 * Counter and progress bar (PRD §2.8; owner Q2, 4 Nov 2026): every field
 * always, zeros included. Left, right, tie and both bad count judged pairs;
 * kept, rejected, skipped and edited count candidates.
 */

import type { ReviewState } from '../../store/useReviewStore';

export interface ProgressBarProps {
  counts: ReturnType<ReviewState['counts']>;
  mode: 'compare' | 'single';
}

const n = (value: number) => value.toLocaleString('en-US');

export function ProgressBar({ counts, mode }: ProgressBarProps) {
  const parts =
    mode === 'compare'
      ? [
          `${n(counts.reviewed)} / ${n(counts.total)} prompts`,
          `${n(counts.left)} left`,
          `${n(counts.right)} right`,
          `${n(counts.tie)} tie`,
          `${n(counts.bothBad)} both bad`,
        ]
      : [`${n(counts.reviewed)} / ${n(counts.total)} records`];
  parts.push(
    `${n(counts.kept)} kept`,
    `${n(counts.rejected)} rejected`,
    `${n(counts.skipped)} skipped`,
    `${n(counts.edited)} edited`
  );
  if (counts.unparseable > 0) parts.push(`${n(counts.unparseable)} unparseable`);

  const percent = counts.total > 0 ? (counts.reviewed / counts.total) * 100 : 0;

  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label="Reviewed"
        aria-valuemin={0}
        aria-valuenow={counts.reviewed}
        aria-valuemax={counts.total}
        className="h-1.5 w-full rounded bg-muted overflow-hidden"
      >
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="text-xs text-muted-foreground" data-testid="progress-text">
        {parts.join(' · ')}
      </div>
    </div>
  );
}
