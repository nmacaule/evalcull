/**
 * Main application component for WP 6a.
 * Integrates CompareView/SingleView, hotkeys, SchemaMapper, and file loading.
 * WP 6c: Refs name lines — compare mode shows the knockout pair of the
 * prompt's candidates, each card loaded from its own line; single mode acts
 * on the line ref "i".
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useReviewStore } from './store/useReviewStore';
import { formatPromptRef, parseRefLine } from './store/refs';
import { buildGroupLines, deriveKnockout, promptCandidates } from './lib/knockout';
import { CompareView } from './components/CompareView';
import { SingleView } from './components/SingleView';
import { Editor } from './components/Editor';
import { EditConfirmView } from './components/EditConfirmView';
import { CheatSheet } from './components/CheatSheet';
import { SchemaMapper } from './components/SchemaMapper';
import { Button } from '@/components/ui/button';
import { useLoadFile } from './hooks/useLoadFile';
import { useHotkeys } from './hooks/useHotkeys';
import { parsePath, normalisePath, stringifyPath, getByPath } from './lib/path';
import type { CandidateRef, RecordFormat } from './types';
import type { ParsedRecord } from './store/types';

/**
 * Edit path for the candidate a ref names (WP 6c decision l): the response of a
 * row candidate "i", candidatesPath[k] for "i:k", chosen/rejected for preference.
 */
function editPathFor(ref: CandidateRef, format: RecordFormat): string | null {
  const colon = ref.indexOf(':');
  const k = colon === -1 ? null : parseInt(ref.slice(colon + 1), 10);
  switch (format.kind) {
    case 'flat':
      return format.responsePath;
    case 'messages':
      // Default to first turn; user can select another turn in the card
      return `${format.path}[0].${format.contentKey}`;
    case 'preference':
      return k === 1 ? format.rejectedPath : format.chosenPath;
    case 'candidates':
      return `${format.candidatesPath}[${k ?? 0}]`;
    default:
      return null; // Can't edit unknown format
  }
}

/** Filter mode values from store */
type FilterMode =
  | 'all'
  | 'unreviewed'
  | 'kept'
  | 'rejected'
  | 'skipped'
  | 'edited'
  | 'unparseable';

const FILTER_CYCLE: FilterMode[] = ['all', 'unreviewed', 'kept', 'rejected', 'skipped', 'edited'];

function App() {
  // Store state
  const source = useReviewStore((s) => s.source);
  const format = useReviewStore((s) => s.format);
  const mode = useReviewStore((s) => s.mode);
  const cursor = useReviewStore((s) => s.cursor);
  const focus = useReviewStore((s) => s.focus);
  const decisions = useReviewStore((s) => s.decisions);
  const filter = useReviewStore((s) => s.filter);

  // Store actions
  const prefer = useReviewStore((s) => s.prefer);
  const setStrength = useReviewStore((s) => s.setStrength);
  const decide = useReviewStore((s) => s.decide);
  const edit = useReviewStore((s) => s.edit);
  const undo = useReviewStore((s) => s.undo);
  const redo = useReviewStore((s) => s.redo);
  const next = useReviewStore((s) => s.next);
  const prev = useReviewStore((s) => s.prev);
  const toggleFocus = useReviewStore((s) => s.toggleFocus);
  const setFilter = useReviewStore((s) => s.setFilter);
  const setFormat = useReviewStore((s) => s.setFormat);
  const record = useReviewStore((s) => s.record);

  // Local UI state
  const [showRaw, setShowRaw] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [schemaMapperOpen, setSchemaMapperOpen] = useState(false);
  const [isRegrouping, setIsRegrouping] = useState(false);

  // Editing state (held in App per plan decision, not in store)
  const [editing, setEditing] = useState<{
    ref: CandidateRef;
    path: string;
    initialValue: string;
  } | null>(null);

  // Edit confirmation state (decision i)
  const [editConfirm, setEditConfirm] = useState<{
    ref: CandidateRef;
    path: string;
    originalValue: string;
  } | null>(null);

  // Error state (surfaced in header, cleared on next success)
  const [lastError, setLastError] = useState<string | null>(null);

  // Loaded records for current cursor
  const [leftRecord, setLeftRecord] = useState<ParsedRecord | null>(null);
  const [rightRecord, setRightRecord] = useState<ParsedRecord | null>(null);
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');

  // File loading
  const { isLoading, error: loadError, progress, handleFileChange } = useLoadFile();

  // Candidate model for the prompt at the cursor (compare mode, JSONL)
  const index = source?.kind === 'jsonl' ? source.index : null;
  const groups = index?.groups;
  const groupCount = index?.groupCount ?? 0;
  const candidatesPerLine = index?.candidates;
  const groupTable = useMemo(
    () => (groups ? buildGroupLines(groups, groupCount) : null),
    [groups, groupCount]
  );

  const prompt = useMemo(() => {
    if (mode !== 'compare' || !groupTable || !candidatesPerLine) return null;
    if (cursor >= groupCount) return null;
    return promptCandidates(groupTable, candidatesPerLine, format, cursor);
  }, [mode, groupTable, candidatesPerLine, groupCount, format, cursor]);

  const knockout = useMemo(
    () =>
      prompt
        ? deriveKnockout(prompt.candidates, decisions.get(prompt.promptRef)?.compare)
        : null,
    [prompt, decisions]
  );

  // N; a prompt with fewer than two candidates is shown as one card (6a decision g)
  const candidateCount = prompt?.candidates.length ?? 0;
  const singleCard = mode === 'single' || candidateCount < 2;
  const groupSize = mode === 'compare' ? candidateCount : 1;

  // Refs name lines: single mode "i"; compare mode the knockout pair shown,
  // or candidates[0] ?? promptRef for a one-candidate prompt
  const leftRef: CandidateRef = !source
    ? ''
    : mode === 'single'
      ? formatPromptRef(cursor)
      : prompt
        ? (knockout?.shown?.left ?? prompt.candidates[0] ?? prompt.promptRef)
        : '';
  const rightRef: CandidateRef = !singleCard && knockout?.shown ? knockout.shown.right : '';

  // Load each shown candidate's own line
  useEffect(() => {
    if (!source || source.kind !== 'jsonl' || !leftRef) return;

    const loadRecords = async () => {
      try {
        const leftLine = parseRefLine(leftRef);
        const left = await record(leftLine);
        setLeftRecord(left);
        setLeftText(await source.readText(leftLine));

        if (rightRef) {
          const rightLine = parseRefLine(rightRef);
          const right = await record(rightLine);
          setRightRecord(right);
          setRightText(await source.readText(rightLine));
        } else {
          setRightRecord(null);
          setRightText('');
        }
        setLastError(null);
      } catch (err) {
        setLastError(`Failed to load records: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    loadRecords();
  }, [source, leftRef, rightRef, record]);

  // Auto-open SchemaMapper for unknown format
  useEffect(() => {
    if (source && format.kind === 'unknown' && !schemaMapperOpen) {
      setSchemaMapperOpen(true);
    }
  }, [source, format.kind, schemaMapperOpen]);

  // Default to raw view for unknown format
  useEffect(() => {
    if (format.kind === 'unknown') {
      setShowRaw(true);
    }
  }, [format.kind]);

  // Get edits for current refs
  const leftEdits = useMemo(
    () => decisions.get(leftRef)?.edits,
    [decisions, leftRef]
  );
  const rightEdits = useMemo(
    () => decisions.get(rightRef)?.edits,
    [decisions, rightRef]
  );

  // Get focused ref: a single card's ref, else the focused side of the pair
  const getFocusedRef = useCallback((): CandidateRef => {
    if (singleCard) return leftRef;
    return focus === 0 ? leftRef : rightRef;
  }, [singleCard, focus, leftRef, rightRef]);

  // Open editor for focused candidate, at the path its ref names
  const openEditor = useCallback(() => {
    if (!leftRecord || (leftRecord && !leftRecord.ok)) return;

    const ref = getFocusedRef();
    const currentRecord = focus === 0 || singleCard ? leftRecord : rightRecord;
    if (!currentRecord || !currentRecord.ok) return;

    const path = editPathFor(ref, format);
    if (path === null) return;

    // Get initial value
    try {
      const segments = parsePath(path);
      const value = getByPath(currentRecord.data, segments);
      setEditing({
        ref,
        path,
        initialValue: String(value ?? ''),
      });
      setLastError(null);
    } catch (err) {
      setLastError(`Failed to open editor: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [leftRecord, rightRecord, focus, singleCard, format, getFocusedRef]);

  // Save editor
  const saveEditor = useCallback(() => {
    if (!editing) return;
    // Will be called from Editor component
  }, [editing]);

  // Cancel editor
  const cancelEditor = useCallback(() => {
    setEditing(null);
    setEditConfirm(null);
  }, []);

  // Handle editor save
  const handleEditorSave = useCallback(
    (newValue: string) => {
      if (!editing) return;

      // Get the record to normalize the path
      const currentRecord =
        focus === 0 || singleCard ? leftRecord : rightRecord;
      if (!currentRecord || !currentRecord.ok) return;

      // Normalize path (convert negative indices to positive)
      try {
        const segments = parsePath(editing.path);
        const normalizedSegments = normalisePath(segments, (segs) => {
          const arr = getByPath(currentRecord.data, segs);
          return Array.isArray(arr) ? arr.length : 0;
        });
        const normalizedPath = stringifyPath(normalizedSegments);

        // Save to store
        edit(editing.ref, normalizedPath, newValue);

        // Enter edit confirmation mode (decision i)
        setEditConfirm({
          ref: editing.ref,
          path: normalizedPath,
          originalValue: editing.initialValue,
        });
        setEditing(null);
        setLastError(null);
      } catch (err) {
        setLastError(`Failed to save edit: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [editing, focus, singleCard, leftRecord, rightRecord, edit]
  );

  // Handle edit confirmation (decision i)
  const handleEditConfirmKeep = useCallback(() => {
    setEditConfirm(null);
  }, []);

  const handleEditConfirmDiscard = useCallback(() => {
    if (!editConfirm) return;
    // Remove the edit by calling edit with undefined
    edit(editConfirm.ref, editConfirm.path, undefined);
    setEditConfirm(null);
  }, [editConfirm, edit]);

  // Scroll handlers (no-op for now, could scroll the card)
  const scrollUp = useCallback(() => {
    // Could implement card scrolling
  }, []);

  const scrollDown = useCallback(() => {
    // Could implement card scrolling
  }, []);

  // Cycle filter
  const cycleFilter = useCallback(() => {
    const currentIndex = FILTER_CYCLE.indexOf(filter as FilterMode);
    const nextIndex = (currentIndex + 1) % FILTER_CYCLE.length;
    setFilter(FILTER_CYCLE[nextIndex]);
  }, [filter, setFilter]);

  // Show cheat sheet
  const showCheatSheet = useCallback(() => {
    setCheatSheetOpen((prev) => !prev);
  }, []);

  // Handle SchemaMapper apply
  const handleSchemaMapperApply = useCallback(
    async (newFormat: typeof format) => {
      setIsRegrouping(true);
      try {
        await setFormat(newFormat);
      } finally {
        setIsRegrouping(false);
      }
    },
    [setFormat]
  );

  // Handle edit from card
  const handleCardEdit = useCallback(
    (ref: CandidateRef, path: string) => {
      const currentRecord =
        ref === leftRef ? leftRecord : ref === rightRef ? rightRecord : null;
      if (!currentRecord || !currentRecord.ok) return;

      try {
        const segments = parsePath(path);
        const value = getByPath(currentRecord.data, segments);
        setEditing({
          ref,
          path,
          initialValue: String(value ?? ''),
        });
        setLastError(null);
      } catch (err) {
        setLastError(`Failed to open editor: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [leftRecord, rightRecord, leftRef, rightRef]
  );

  // Sample records for SchemaMapper
  const sampleRecords = useMemo(() => {
    if (!leftRecord || !leftRecord.ok) return [];
    return [leftRecord.data];
  }, [leftRecord]);

  // Register hotkeys
  useHotkeys({
    prefer,
    setStrength,
    decide,
    getFocusedRef,
    next,
    prev,
    toggleFocus,
    openEditor,
    saveEditor,
    cancelEditor,
    editConfirmKeep: handleEditConfirmKeep,
    editConfirmDiscard: handleEditConfirmDiscard,
    isEditConfirmOpen: editConfirm !== null,
    undo,
    redo,
    toggleRaw: () => setShowRaw((prev) => !prev),
    toggleWhitespace: () => setShowWhitespace((prev) => !prev),
    cycleFilter,
    showCheatSheet,
    scrollUp,
    scrollDown,
    mode,
    groupSize,
    isModalOpen: schemaMapperOpen || cheatSheetOpen,
    isEditorOpen: editing !== null,
  });

  // No source loaded - show file input
  if (!source) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">evalcull</h1>
        <p className="text-muted-foreground">
          Load a JSONL file to start reviewing
        </p>

        <label className="cursor-pointer">
          <Button asChild variant="outline" disabled={isLoading}>
            <span>
              {isLoading ? (
                <>
                  Loading...
                  {progress && (
                    <span className="ml-2 text-xs">
                      {Math.round((progress.loaded / progress.total) * 100)}%
                    </span>
                  )}
                </>
              ) : (
                'Load file'
              )}
            </span>
          </Button>
          <input
            type="file"
            accept=".jsonl"
            className="hidden"
            onChange={handleFileChange}
            disabled={isLoading}
          />
        </label>

        {loadError && (
          <p className="text-sm text-destructive">{loadError}</p>
        )}
      </div>
    );
  }

  // Row-based sources not yet supported (WP 8)
  if (source.kind !== 'jsonl') {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">evalcull</h1>
        <p className="text-muted-foreground">
          {source.container} files are not supported yet
        </p>
      </div>
    );
  }

  // Show regroup loading overlay
  if (isRegrouping) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Re-grouping records...</p>
        </div>
      </div>
    );
  }

  // Render editor if open
  if (editing) {
    return (
      <div className="min-h-screen bg-background text-foreground p-8">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-lg font-semibold mb-4">
            Editing {editing.ref}
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Path: <code className="font-mono">{editing.path}</code>
          </p>
          <Editor
            initialValue={editing.initialValue}
            onSave={handleEditorSave}
            onCancel={cancelEditor}
          />
        </div>
      </div>
    );
  }

  // Render edit confirmation (decision i)
  if (editConfirm) {
    const currentEdits = decisions.get(editConfirm.ref)?.edits ?? {};
    const editedValue = currentEdits[editConfirm.path];

    return (
      <EditConfirmView
        originalValue={editConfirm.originalValue}
        editedValue={String(editedValue ?? '')}
        onKeep={handleEditConfirmKeep}
        onDiscard={handleEditConfirmDiscard}
        onDismiss={cancelEditor}
      />
    );
  }

  // Main view
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-semibold">evalcull</h1>
            <span className="text-sm text-muted-foreground">
              {useReviewStore.getState().sourceName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Filter: {filter}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSchemaMapperOpen(true)}
            >
              Configure format
            </Button>
          </div>
        </div>
        {lastError && (
          <div className="text-sm text-destructive mt-1">{lastError}</div>
        )}
      </header>

      {/* Main content */}
      <main className="p-4">
        {mode === 'compare' ? (
          leftRecord && (singleCard || rightRecord) ? (
            singleCard || !knockout ? (
              // Prompt with fewer than two candidates in compare mode
              <div className="max-w-3xl mx-auto">
                <div className="text-center text-sm text-muted-foreground mb-4">
                  Only one candidate for this prompt
                </div>
                <SingleView
                  record={leftRecord}
                  rawText={leftText}
                  candidateRef={leftRef}
                  format={format}
                  showRaw={showRaw}
                  showWhitespace={showWhitespace}
                  edits={leftEdits}
                  onEdit={(path) => handleCardEdit(leftRef, path)}
                />
              </div>
            ) : (
              <CompareView
                leftRecord={leftRecord}
                rightRecord={rightRecord!}
                leftRef={leftRef}
                rightRef={rightRef}
                leftText={leftText}
                rightText={rightText}
                leftEdits={leftEdits}
                rightEdits={rightEdits}
                focus={focus}
                format={format}
                showRaw={showRaw}
                showWhitespace={showWhitespace}
                knockout={knockout}
                candidateCount={candidateCount}
                onEdit={handleCardEdit}
              />
            )
          ) : (
            <div className="text-center text-muted-foreground">Loading...</div>
          )
        ) : leftRecord ? (
          <SingleView
            record={leftRecord}
            rawText={leftText}
            candidateRef={leftRef}
            format={format}
            showRaw={showRaw}
            showWhitespace={showWhitespace}
            edits={leftEdits}
            onEdit={(path) => handleCardEdit(leftRef, path)}
          />
        ) : (
          <div className="text-center text-muted-foreground">Loading...</div>
        )}

        {/* Navigation info */}
        <div className="mt-4 text-center text-sm text-muted-foreground">
          Prompt {cursor + 1} of {source.index.groupCount}
        </div>
      </main>

      {/* Cheat sheet dialog */}
      <CheatSheet open={cheatSheetOpen} onOpenChange={setCheatSheetOpen} />

      {/* Schema mapper dialog */}
      <SchemaMapper
        open={schemaMapperOpen}
        onOpenChange={setSchemaMapperOpen}
        currentFormat={format}
        sampleRecords={sampleRecords}
        onApply={handleSchemaMapperApply}
      />
    </div>
  );
}

export default App;
