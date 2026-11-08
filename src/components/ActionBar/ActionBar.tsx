/**
 * The review actions as visible controls (PRD §2.2 v3.6, DR-028): one secondary button per
 * action that applies, its keys in keycaps and in aria-keyshortcuts. A click calls the same
 * handler the key calls. A labelled region, not a toolbar (←/→ are preference keys) and not
 * a group (the cards are the groups).
 */

import { Button } from '@/components/ui/button';
import { Keycap } from '../Keycap';
import { isCharacterKey } from '../../lib/hotkeyTable';
import { keyLabel, keyShortcut } from '../../lib/platform';
import type { DecisionStatus, Preference } from '../../types';

export interface ActionBarProps {
  mode: 'compare' | 'single';
  /** N in compare mode; the preferences need two candidates */
  groupSize: number;
  /** An Other record is always raw, so there is no raw-view toggle (D-113) */
  rawToggle: boolean;
  /** Single-key shortcuts on (DR-029): off drops every character key from the bar */
  characterKeys: boolean;
  /** The strength of the pair just judged, or null when no pair has been judged */
  strength: 1 | 2 | 3 | undefined | null;
  /** The current filter, named on the Filter button since the header no longer shows it */
  filter: string;
  prefer: (p: Preference) => void;
  setStrength: (s: 1 | 2 | 3) => void;
  decide: (status: DecisionStatus) => void;
  openEditor: () => void;
  undo: () => void;
  redo: () => void;
  next: () => void;
  prev: () => void;
  toggleRaw: () => void;
  toggleWhitespace: () => void;
  toggleReadingStep: () => void;
  cycleFilter: () => void;
  toggleMetadata: () => void;
  openLabels: () => void;
  openNotes: () => void;
  openGoTo: () => void;
  openSearch: () => void;
}

interface Action {
  label: string;
  /** Actions sharing a pair wrap together, never apart (Undo and Redo, owner, 8 Nov 2026) */
  pair?: string;
  keys: string[];
  run: () => void;
  disabled?: boolean;
  pressed?: boolean;
}

export function ActionBar(props: ActionBarProps) {
  const { mode, groupSize, rawToggle, characterKeys, strength, filter } = props;
  const live = (key: string) => characterKeys || !isCharacterKey(key);
  const noPair = groupSize < 2;

  const decisions: Action[] = [
    ...(mode === 'compare'
      ? [
          { label: 'Left is better', keys: ['ArrowLeft', '1'], run: () => props.prefer('left'), disabled: noPair },
          { label: 'Tie', keys: ['=', '0'], run: () => props.prefer('tie'), disabled: noPair },
          { label: 'Both bad', keys: ['x'], run: () => props.prefer('both_bad'), disabled: noPair },
          { label: 'Right is better', keys: ['ArrowRight', '2'], run: () => props.prefer('right'), disabled: noPair },
        ]
      : []),
    { label: 'Keep', keys: ['a'], run: () => props.decide('kept') },
    { label: 'Reject', keys: ['r'], run: () => props.decide('rejected') },
    { label: 'Skip', keys: ['s'], run: () => props.decide('skipped') },
    { label: 'Edit', keys: ['e'], run: props.openEditor },
    { label: 'Undo', keys: ['u'], run: props.undo, pair: 'history' },
    { label: 'Redo', keys: ['Shift+u'], run: props.redo, pair: 'history' },
  ];

  // Strength attaches to the pair just judged (§2.2), so it is offered once a pair is judged
  const strengths: Action[] =
    mode === 'compare' && strength !== null
      ? [
          { label: 'Much better', keys: ['Shift+1'], run: () => props.setStrength(1), pressed: strength === 1 },
          { label: 'Better', keys: ['Shift+2'], run: () => props.setStrength(2), pressed: strength === 2 },
          { label: 'Slightly better', keys: ['Shift+3'], run: () => props.setStrength(3), pressed: strength === 3 },
        ]
      : [];

  const views: Action[] = [
    { label: 'Previous', keys: ['k'], run: props.prev },
    { label: 'Next', keys: ['j'], run: props.next },
    ...(rawToggle ? [{ label: 'Raw', keys: ['t'], run: props.toggleRaw }] : []),
    { label: 'Whitespace', keys: ['w'], run: props.toggleWhitespace },
    { label: 'Text size', keys: ['z'], run: props.toggleReadingStep },
    { label: 'Details', keys: ['m'], run: props.toggleMetadata },
    { label: 'Labels', keys: ['l'], run: props.openLabels },
    { label: 'Notes', keys: ['n'], run: props.openNotes },
    { label: 'Go to', keys: ['g'], run: props.openGoTo },
    { label: 'Search', keys: ['/'], run: props.openSearch },
    { label: `Filter: ${filter}`, keys: ['f'], run: props.cycleFilter },
  ];

  const renderButton = (a: Action) => {
    const keys = a.keys.filter(live);
    return (
      <Button
        key={a.label}
        variant="secondary"
        size="sm"
        disabled={a.disabled}
        aria-pressed={a.pressed === undefined ? undefined : a.pressed}
        aria-keyshortcuts={keys.length ? keys.map(keyShortcut).join(' ') : undefined}
        onClick={a.run}
      >
        {a.label}
        {keys.map((k) => (
          <Keycap key={k}>{keyLabel(k)}</Keycap>
        ))}
      </Button>
    );
  };

  // A pair is one flex item that does not wrap inside, so its buttons move to a new row together
  const renderRow = (actions: Action[], name: string) => {
    const items: (Action | Action[])[] = [];
    for (const a of actions) {
      const last = items[items.length - 1];
      if (a.pair && Array.isArray(last) && last[0].pair === a.pair) last.push(a);
      else items.push(a.pair ? [a] : a);
    }
    return (
      <div className="flex flex-wrap justify-center gap-2" data-action-row={name}>
        {items.map((item) =>
          Array.isArray(item) ? (
            <span key={item[0].pair} className="inline-flex gap-2" data-action-pair={item[0].pair}>
              {item.map(renderButton)}
            </span>
          ) : (
            renderButton(item)
          )
        )}
      </div>
    );
  };

  return (
    <section aria-label="Review actions" className="mt-6 flex flex-col gap-2 text-chrome">
      {renderRow(decisions, 'decisions')}
      {strengths.length > 0 && renderRow(strengths, 'strength')}
      {renderRow(views, 'views')}
    </section>
  );
}
