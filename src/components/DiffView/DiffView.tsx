/**
 * Line diff of an original and an edited value (PRD §2.5).
 * WP 7b (PRD §2.11 Diff, O13): an inserted line on diff-insert-bg with a "+" in
 * status-kept, a deleted line on diff-delete-bg with a "−" in status-rejected,
 * unchanged lines untinted; line text neutral-12 in text-mono. The marks carry
 * the change beside the hue, and every line keeps its aria-label.
 */

import { useMemo } from 'react';
import { diffLines } from '../../lib/diff';

const MARK = { equal: ' ', delete: '−', insert: '+' } as const;
const LABEL = { equal: 'unchanged', delete: 'removed', insert: 'added' } as const;
const TONE = {
  equal: '',
  delete: 'bg-diff-delete-bg',
  insert: 'bg-diff-insert-bg',
} as const;
const MARK_TONE = {
  equal: 'text-neutral-11',
  delete: 'text-status-rejected',
  insert: 'text-status-kept',
} as const;

export interface DiffViewProps {
  original: string;
  edited: string;
  /** One side of a split diff: the original's lines or the edited lines (§2.11 screen 6) */
  side?: 'original' | 'edited';
}

export function DiffView({ original, edited, side }: DiffViewProps) {
  const ops = useMemo(() => {
    const all = diffLines(original, edited);
    if (side === 'original') return all.filter((o) => o.op !== 'insert');
    if (side === 'edited') return all.filter((o) => o.op !== 'delete');
    return all;
  }, [original, edited, side]);
  return (
    <pre className="overflow-auto font-mono text-mono text-neutral-12 rounded-control py-2" aria-label="Diff">
      {ops.map((o, i) => (
        <div key={i} className={`px-2 ${TONE[o.op]}`} aria-label={`${LABEL[o.op]}: ${o.text}`}>
          <span data-diff-mark aria-hidden="true" className={`select-none mr-2 ${MARK_TONE[o.op]}`}>
            {MARK[o.op]}
          </span>
          {o.text}
        </div>
      ))}
    </pre>
  );
}
