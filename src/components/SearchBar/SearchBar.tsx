/**
 * Search bar for / (PRD §2.2; owner Q5, 4 Nov 2026) over the file's raw text,
 * through src/lib/search.ts. A generation counter, bumped by a new search,
 * closing the bar and any cursor change, stops a slow search from moving the
 * cursor after the reviewer has moved on.
 */

import { useEffect, useRef, useState } from 'react';
import { useReviewStore } from '../../store/useReviewStore';
import { searchRaw } from '../../lib/search';

export interface SearchBarProps {
  onClose: () => void;
}

export function SearchBar({ onClose }: SearchBarProps) {
  const cursor = useReviewStore((s) => s.cursor);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
  }, [cursor]);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );

  const run = async () => {
    const { source, mode, cursor: at, goTo } = useReviewStore.getState();
    if (!source || source.kind !== 'jsonl' || query === '') return;
    const gen = ++generation.current;
    setSearching(true);
    setMessage(null);
    const result = await searchRaw(source, {
      query,
      mode,
      cursor: at,
      isStale: () => generation.current !== gen,
    });
    setSearching(false);
    if (generation.current !== gen) return;
    if (result.kind === 'match') {
      goTo(mode === 'compare' ? source.index.groups[result.line] : result.line);
    } else if (result.kind === 'only-current') {
      setMessage(mode === 'compare' ? 'Only match is in this prompt.' : 'Only match is in this record.');
    } else if (result.kind === 'none') {
      setMessage('No match.');
    }
  };

  return (
    <div role="search" className="flex items-center gap-2 border-b px-4 py-2 text-sm">
      <input
        aria-label="Search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            run();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            generation.current++;
            onClose();
          }
        }}
        className="h-8 w-80 rounded-md border border-input bg-background px-2"
      />
      <span className="text-muted-foreground">Searches the file's raw text.</span>
      {searching && <span className="text-muted-foreground">Searching…</span>}
      {message && <span role="status">{message}</span>}
    </div>
  );
}
