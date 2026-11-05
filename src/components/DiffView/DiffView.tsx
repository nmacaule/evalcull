/**
 * Line diff of an original and an edited value (PRD §2.5).
 */

import { useMemo } from 'react';
import { diffLines } from '../../lib/diff';

export interface DiffViewProps {
  original: string;
  edited: string;
}

const MARK = { equal: ' ', delete: '-', insert: '+' } as const;
const LABEL = { equal: 'unchanged', delete: 'removed', insert: 'added' } as const;
const TONE = {
  equal: '',
  delete: 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200',
  insert: 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200',
} as const;

export function DiffView({ original, edited }: DiffViewProps) {
  const ops = useMemo(() => diffLines(original, edited), [original, edited]);
  return (
    <pre className="overflow-auto font-mono text-sm rounded-md bg-muted/50 p-2" aria-label="Diff">
      {ops.map((o, i) => (
        <div key={i} className={TONE[o.op]} aria-label={`${LABEL[o.op]}: ${o.text}`}>
          <span className="select-none text-muted-foreground mr-2">{MARK[o.op]}</span>
          {o.text}
        </div>
      ))}
    </pre>
  );
}
