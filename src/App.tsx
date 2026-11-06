/**
 * Main application component for WP 6a.
 * Integrates CompareView/SingleView, hotkeys, SchemaMapper, and file loading.
 * WP 6c: Refs name lines — compare mode shows the knockout pair of the
 * prompt's candidates, each card loaded from its own line; single mode acts
 * on the line ref "i".
 * WP 6b: the prompt above the cards (D-013), card statuses (D-016), edits of
 * non-string values as JSON (D-018), assistant-turn editing (D-017, D-019),
 * ↑/↓ scroll (D-019), the unparseable filter (D-021), the position line
 * (D-020) and the mapping modal's sample of up to 10 records (D-024).
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useReviewStore } from './store/useReviewStore';
import { formatPromptRef, parseRefLine } from './store/refs';
import { buildGroupLines, deriveKnockout, promptCandidates } from './lib/knockout';
import { CompareView } from './components/CompareView';
import { SingleView } from './components/SingleView';
import { Editor } from './components/Editor';
import { EditConfirmView } from './components/EditConfirmView';
import { CheatSheet } from './components/CheatSheet';
import { SchemaMapper } from './components/SchemaMapper';
import { PromptHeader } from './components/PromptHeader';
import { Button } from '@/components/ui/button';
import { Dropzone } from './components/Dropzone';
import { ProgressBar } from './components/ProgressBar';
import { StorageIndicator } from './components/StorageIndicator';
import { MetadataPanel } from './components/MetadataPanel';
import { ExportPanel } from './components/ExportPanel';
import { LabelNotesPanel } from './components/LabelNotesPanel';
import { GoToDialog } from './components/GoToDialog';
import { SearchBar } from './components/SearchBar';
import { useHotkeys } from './hooks/useHotkeys';
import { parsePath, normalisePath, stringifyPath, getByPath } from './lib/path';
import { displayValue } from './lib/display';
import { losslessParse, losslessStringify } from './lib/lossless';
import type { CandidateRef, RecordFormat } from './types';
import type { ParsedRecord } from './store/types';

/** Indices of a conversation's assistant turns, by the format's assistant roles. */
function assistantTurns(data: unknown, format: RecordFormat): number[] {
  if (format.kind !== 'messages') return [];
  const messages = getByPath(data, parsePath(format.path));
  if (!Array.isArray(messages)) return [];
  const turns: number[] = [];
  messages.forEach((m, i) => {
    const role = m && typeof m === 'object' ? (m as Record<string, unknown>)[format.roleKey] : undefined;
    if (typeof role === 'string' && format.roles.assistant.includes(role)) turns.push(i);
  });
  return turns;
}

// An edit's path as the store keeps it: negative indices resolved against the
// record the editor was opened for, a Normalized Path (RFC 9535 §2.3.3.2, §2.7; D-086)
function normalisedPath(path: string, data: unknown): string {
  return stringifyPath(
    normalisePath(parsePath(path), (segs) => {
      const arr = getByPath(data, segs);
      return Array.isArray(arr) ? arr.length : 0;
    })
  );
}

function turnPath(format: Extract<RecordFormat, { kind: 'messages' }>, turn: number): string {
  return `${format.path}[${turn}].${format.contentKey}`;
}

/**
 * Edit path for the candidate a ref names (WP 6c decision l): the response of a
 * row candidate "i", candidatesPath[k] for "i:k", chosen/rejected for preference,
 * the last assistant turn of a conversation (D-017).
 */
function editPathFor(ref: CandidateRef, format: RecordFormat, data: unknown): string | null {
  const colon = ref.indexOf(':');
  const k = colon === -1 ? null : parseInt(ref.slice(colon + 1), 10);
  switch (format.kind) {
    case 'flat':
      return format.responsePath;
    case 'messages': {
      const turns = assistantTurns(data, format);
      return turns.length ? turnPath(format, turns[turns.length - 1]) : null;
    }
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

const FILTER_CYCLE: FilterMode[] = ['all', 'unreviewed', 'kept', 'rejected', 'skipped', 'edited', 'unparseable'];

// A card's record and raw text, with the file and line they were read for (D-083, D-084)
interface HeldRecord {
  fingerprint: string;
  line: number;
  record: ParsedRecord;
  text: string;
}

function heldFor(held: HeldRecord | null, fingerprint: string, ref: CandidateRef): HeldRecord | null {
  if (!held || !ref) return null;
  return held.fingerprint === fingerprint && held.line === parseRefLine(ref) ? held : null;
}

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
  // The mapping modal holds a draft only once the user has changed a field (DR-001 rule 6, D-069)
  const [mapperDraft, setMapperDraft] = useState(false);
  // The file the mapping modal last opened by itself for: once per file, so Cancel keeps it closed (D-069)
  const autoOpenedFor = useRef<string | null>(null);
  const [isRegrouping, setIsRegrouping] = useState(false);

  // Editing state (held in App per plan decision, not in store)
  const [editing, setEditing] = useState<{
    ref: CandidateRef;
    path: string;
    initialValue: string;
    /** The value is not a string: edited as JSON text, parsed on save (D-018) */
    isJson: boolean;
    /** The data of the record the editor was opened for; the save resolves the path against it (D-085) */
    data: unknown;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Edit confirmation state (decision i)
  const [editConfirm, setEditConfirm] = useState<{
    ref: CandidateRef;
    path: string;
    originalValue: string;
    /** The edit stored at the path before this one, which a discard restores (D-031) */
    previous: { value: unknown } | null;
  } | null>(null);

  // E pressed before the focused card's record has loaded: one pending intent for
  // this file, line and card, fulfilled when that record arrives (DR-012, D-092)
  const [pendingEdit, setPendingEdit] = useState<{ fingerprint: string; cursor: number; focus: number } | null>(null);

  // Error state (surfaced in header, cleared on next success)
  const [lastError, setLastError] = useState<string | null>(null);

  // Records read for the cards, each with the file and line it was read for
  const [leftHeld, setLeftHeld] = useState<HeldRecord | null>(null);
  const [rightHeld, setRightHeld] = useState<HeldRecord | null>(null);

  // Panels (WP 6b)
  const storageState = useReviewStore((s) => s.storageState);
  const sourceName = useReviewStore((s) => s.sourceName);
  const counts = useReviewStore((s) => s.counts);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [labelNotes, setLabelNotes] = useState<'labels' | 'notes' | null>(null);
  const [goToOpen, setGoToOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);
  // A file is opening, for every entry point: the store's switch (D-038, D-039,
  // DR-001 rule 6); the app counts as modal meanwhile
  const fileOpening = useReviewStore((s) => s.switching.kind === 'opening');
  const fingerprint = useReviewStore((s) => s.fingerprint);

  // A new file closes what was open on the previous one (D-038)
  useEffect(() => {
    setEditing(null);
    setEditConfirm(null);
    setEditError(null);
    setLabelNotes(null);
    setGoToOpen(false);
    setSearchOpen(false);
    setSchemaMapperOpen(false);
  }, [fingerprint]);

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

  // A held record counts as loaded only for the file and line it was read for, so
  // neither the cards nor the editor use the previous one while a line loads (D-083, D-084)
  const leftShown = heldFor(leftHeld, fingerprint, leftRef);
  const rightShown = heldFor(rightHeld, fingerprint, rightRef);
  const leftRecord = leftShown?.record ?? null;
  const rightRecord = rightShown?.record ?? null;
  const leftText = leftShown?.text ?? '';
  const rightText = rightShown?.text ?? '';

  // Load each shown candidate's own line. A result that arrives after the
  // cursor or the file moved on is ignored (React's ignore flag, PRD S112; D-065)
  useEffect(() => {
    if (!source || source.kind !== 'jsonl' || !leftRef) return;
    let ignore = false;
    const readFor = fingerprint;

    const loadRecords = async () => {
      try {
        const leftLine = parseRefLine(leftRef);
        const left = await record(leftLine);
        const leftRaw = await source.readText(leftLine);
        if (ignore) return;
        setLeftHeld({ fingerprint: readFor, line: leftLine, record: left, text: leftRaw });

        if (rightRef) {
          const rightLine = parseRefLine(rightRef);
          const right = await record(rightLine);
          const rightRaw = await source.readText(rightLine);
          if (ignore) return;
          setRightHeld({ fingerprint: readFor, line: rightLine, record: right, text: rightRaw });
        } else {
          setRightHeld(null);
        }
        setLastError(null);
      } catch (err) {
        if (ignore) return;
        setLastError(`Failed to load records: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    loadRecords();
    return () => {
      ignore = true;
    };
  }, [source, fingerprint, leftRef, rightRef, record]);

  // Auto-open SchemaMapper for unknown format, once per file: Cancel keeps it
  // closed, and Configure format opens it again (D-069)
  useEffect(() => {
    if (source && format.kind === 'unknown' && autoOpenedFor.current !== fingerprint) {
      autoOpenedFor.current = fingerprint;
      setSchemaMapperOpen(true);
    }
  }, [source, format.kind, fingerprint]);

  // A closed mapping modal holds no draft
  useEffect(() => {
    if (!schemaMapperOpen) setMapperDraft(false);
  }, [schemaMapperOpen]);

  // Each format kind opens in its default view: raw for unknown only (WP 6a d). The
  // store starts with unknown before any file is open, so the default must also be
  // cleared when a file of a known format arrives (D-091)
  useEffect(() => {
    setShowRaw(format.kind === 'unknown');
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

  // Open the editor on a path of a ref, at its current value: the stored edit
  // when there is one, else the record's; a non-string value as JSON text (D-018).
  // The path is normalised once, here, against the record opened; the lookup,
  // the save and the turn switch all use that one path (D-086)
  const beginEdit = useCallback(
    (ref: CandidateRef, rawPath: string, data: unknown) => {
      try {
        const path = normalisedPath(rawPath, data);
        const stored = decisions.get(ref)?.edits;
        const value =
          stored && Object.prototype.hasOwnProperty.call(stored, path)
            ? stored[path]
            : getByPath(data, parsePath(path));
        const isJson = value !== undefined && typeof value !== 'string';
        setEditing({
          ref,
          path,
          initialValue: isJson ? (losslessStringify(value) ?? '') : ((value as string | undefined) ?? ''),
          isJson,
          data,
        });
        setEditError(null);
        setLastError(null);
      } catch (err) {
        setLastError(`Failed to open editor: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [decisions]
  );

  // Open editor for focused candidate, at the path its ref names
  const openEditor = useCallback(() => {
    const currentRecord = focus === 0 || singleCard ? leftRecord : rightRecord;
    // Not read yet: the key is held, never dropped (DR-012, D-092)
    if (!leftRecord || !currentRecord) {
      setPendingEdit({ fingerprint, cursor, focus });
      return;
    }
    if (!leftRecord.ok || !currentRecord.ok) return;

    const ref = getFocusedRef();

    const path = editPathFor(ref, format, currentRecord.data);
    if (path === null) {
      if (format.kind === 'messages') setLastError('No assistant turn to edit.');
      return;
    }
    beginEdit(ref, path, currentRecord.data);
  }, [leftRecord, rightRecord, focus, singleCard, format, getFocusedRef, beginEdit, fingerprint, cursor]);

  // Save editor
  const saveEditor = useCallback(() => {
    if (!editing) return;
    // Will be called from Editor component
  }, [editing]);

  // Cancel editor
  const cancelEditor = useCallback(() => {
    setEditing(null);
    setEditConfirm(null);
    setEditError(null);
    setPendingEdit(null);
  }, []);

  // A pending E is fulfilled once its card's record arrives for the same file, line
  // and card; a cursor move, Tab or a file switch cancels it (DR-012, D-092)
  const modalOpen =
    schemaMapperOpen || cheatSheetOpen || labelNotes !== null || goToOpen || exportOpen || dropConfirmOpen || fileOpening;
  useEffect(() => {
    if (!pendingEdit) return;
    if (pendingEdit.fingerprint !== fingerprint || pendingEdit.cursor !== cursor || pendingEdit.focus !== focus || modalOpen) {
      setPendingEdit(null);
      return;
    }
    const currentRecord = focus === 0 || singleCard ? leftRecord : rightRecord;
    if (leftRecord && currentRecord) {
      setPendingEdit(null);
      openEditor();
    }
  }, [pendingEdit, fingerprint, cursor, focus, modalOpen, singleCard, leftRecord, rightRecord, openEditor]);

  // A decision key cancels it too (DR-012)
  useEffect(() => {
    setPendingEdit(null);
  }, [decisions]);

  // Handle editor save
  const handleEditorSave = useCallback(
    (newValue: string) => {
      if (!editing) return;

      // The path was normalised when the editor opened, against the record it
      // was opened for, never the focused card's (D-085, D-086)
      try {
        const normalizedPath = editing.path;

        // A non-string value is saved as the JSON it was edited as (D-018)
        let value: unknown = newValue;
        if (editing.isJson) {
          try {
            value = losslessParse(newValue);
          } catch {
            setEditError('Not valid JSON: not saved.');
            return;
          }
        }

        // The edit this one replaces, if any, so a discard can restore it (D-031)
        const stored = decisions.get(editing.ref)?.edits;
        const previous =
          stored && Object.prototype.hasOwnProperty.call(stored, normalizedPath)
            ? { value: stored[normalizedPath] }
            : null;

        // Save to store
        edit(editing.ref, normalizedPath, value);

        // Enter edit confirmation mode (decision i)
        setEditConfirm({
          ref: editing.ref,
          path: normalizedPath,
          originalValue: editing.initialValue,
          previous,
        });
        setEditing(null);
        setEditError(null);
        setLastError(null);
      } catch (err) {
        setLastError(`Failed to save edit: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [editing, edit, decisions]
  );

  // Handle edit confirmation (decision i)
  const handleEditConfirmKeep = useCallback(() => {
    setEditConfirm(null);
  }, []);

  const handleEditConfirmDiscard = useCallback(() => {
    if (!editConfirm) return;
    // Restore the edit this one replaced, or remove the edit when there was none (D-031)
    edit(editConfirm.ref, editConfirm.path, editConfirm.previous ? editConfirm.previous.value : undefined);
    setEditConfirm(null);
  }, [editConfirm, edit]);

  // ↑/↓ scroll the focused card's content by 40 px (D-019, PRD §2.2)
  const scrollFocusedCard = (delta: number) => {
    const el = document.querySelector<HTMLElement>(
      '[role="group"][aria-current="true"] [data-card-content]'
    );
    if (el) el.scrollTop += delta;
  };
  const scrollUp = useCallback(() => scrollFocusedCard(-40), []);
  const scrollDown = useCallback(() => scrollFocusedCard(40), []);

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
      // Nothing opens while a switch is opening, by mouse as by key (DR-001 rule 6, D-072)
      if (fileOpening) return;
      const currentRecord =
        ref === leftRef ? leftRecord : ref === rightRef ? rightRecord : null;
      if (!currentRecord || !currentRecord.ok) return;
      beginEdit(ref, path, currentRecord.data);
    },
    [fileOpening, leftRecord, rightRecord, leftRef, rightRef, beginEdit]
  );

  // Sample for SchemaMapper: up to 10 parseable records from line 0, as the
  // detector samples (WP 5 decision a; D-024)
  const [sampleRecords, setSampleRecords] = useState<unknown[]>([]);
  useEffect(() => {
    if (!schemaMapperOpen || !source || source.kind !== 'jsonl') return;
    let cancelled = false;
    (async () => {
      const sample: unknown[] = [];
      // Scan a bounded prefix so a file of unparseable lines cannot stall the modal
      const limit = Math.min(source.index.lineCount, 1000);
      for (let i = 0; i < limit && sample.length < 10; i++) {
        const parsed = await record(i);
        if (parsed.ok) sample.push(parsed.data);
      }
      if (!cancelled) setSampleRecords(sample);
    })();
    return () => {
      cancelled = true;
    };
  }, [schemaMapperOpen, source, record]);

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
    toggleMetadata: () => setMetadataOpen((prev) => !prev),
    openLabels: () => setLabelNotes('labels'),
    openNotes: () => setLabelNotes('notes'),
    openGoTo: () => setGoToOpen(true),
    openSearch: () => setSearchOpen(true),
    mode,
    groupSize,
    // The search bar is not modal: keys typed in its field are form keys, and
    // J/K stay live so a slow search can be left (its generation goes stale)
    // The editor and its confirmation count as modal: single keys do nothing
    // there; Mod+Enter, Esc and the confirmation's ←/→ are checked first (D-050)
    isModalOpen:
      editing !== null ||
      editConfirm !== null ||
      schemaMapperOpen ||
      cheatSheetOpen ||
      labelNotes !== null ||
      goToOpen ||
      exportOpen ||
      dropConfirmOpen ||
      fileOpening,
    isEditorOpen: editing !== null,
    isEditPending: pendingEdit !== null,
  });

  // No source loaded - the drop target and Open file button
  if (!source) {
    return <Dropzone loaded={false} />;
  }

  // No switch starts while a draft is open, since switching files would lose
  // it: an edit (D-033), a labels and notes draft (D-037) or the mapping modal
  // (D-044); a drop and Open anyway give the same reason (DR-001 rule 6, D-064)
  const draftReason =
    editing || editConfirm
      ? 'Save or cancel the edit first.'
      : labelNotes !== null
        ? 'Save or cancel the labels and notes first.'
        : schemaMapperOpen && mapperDraft
          ? 'Apply or cancel the format first.'
          : null;

  // The drop target stays mounted on every screen while a file is open, so a
  // drop never reaches the browser
  const dropzone = (
    <Dropzone
      loaded={true}
      onConfirmOpenChange={setDropConfirmOpen}
      blockedReason={draftReason}
    />
  );

  // The storage state stays visible on every screen while a file is open (Q6)
  const storageBar = (
    <div className="fixed top-2 right-4">
      <StorageIndicator state={storageState} blockedReason={draftReason} />
    </div>
  );

  // Every screen with a file open returns the same three slots, content, storage
  // bar and drop target, so the Dropzone keeps its state across screens (D-039)
  const withChrome = (content: React.ReactNode, showStorageBar: boolean) => (
    <>
      {content}
      {showStorageBar ? storageBar : null}
      {dropzone}
    </>
  );

  // Row-based sources not yet supported (WP 8)
  if (source.kind !== 'jsonl') {
    return withChrome(
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">evalcull</h1>
        <p className="text-muted-foreground">
          {source.container} files are not supported yet
        </p>
      </div>,
      true
    );
  }

  // Show regroup loading overlay
  if (isRegrouping) {
    return withChrome(
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Re-grouping records...</p>
        </div>
      </div>,
      true
    );
  }

  // Render editor if open
  if (editing) {
    // On a conversation, ↑ at the start or ↓ at the end moves the edit to the
    // previous or next assistant turn while the text is unchanged (D-019)
    // The turns of the record the editor was opened for (D-085)
    let turnSwitch: { onPrev: () => void; onNext: () => void } | undefined;
    if (format.kind === 'messages') {
      const turns = assistantTurns(editing.data, format);
      const at = turns.findIndex((t) => normalisedPath(turnPath(format, t), editing.data) === editing.path);
      if (at !== -1) {
        const move = (to: number) => {
          if (to >= 0 && to < turns.length) {
            beginEdit(editing.ref, turnPath(format, turns[to]), editing.data);
          }
        };
        turnSwitch = { onPrev: () => move(at - 1), onNext: () => move(at + 1) };
      }
    }

    return withChrome(
      <div className="min-h-screen bg-background text-foreground p-8">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-lg font-semibold mb-4">
            Editing {editing.ref}
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Path: <code className="font-mono">{editing.path}</code>
          </p>
          <Editor
            key={`${editing.ref} ${editing.path}`}
            initialValue={editing.initialValue}
            onSave={handleEditorSave}
            onCancel={cancelEditor}
            error={editError}
            turnSwitch={turnSwitch}
          />
        </div>
      </div>,
      true
    );
  }

  // Render edit confirmation (decision i)
  if (editConfirm) {
    const currentEdits = decisions.get(editConfirm.ref)?.edits ?? {};
    const editedValue = currentEdits[editConfirm.path];

    return withChrome(
      <>
        <EditConfirmView
          originalValue={editConfirm.originalValue}
          editedValue={displayValue(editedValue)}
          onKeep={handleEditConfirmKeep}
          onDiscard={handleEditConfirmDiscard}
          onDismiss={cancelEditor}
        />
      </>,
      true
    );
  }

  // Main view
  return withChrome(
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-semibold">evalcull</h1>
            <span className="text-sm text-muted-foreground">{sourceName}</span>
            <StorageIndicator state={storageState} blockedReason={draftReason} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Filter: {filter}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={fileOpening}
              onClick={() => setSchemaMapperOpen(true)}
            >
              Configure format
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              Export
            </Button>
          </div>
        </div>
        <div className="mt-2">
          <ProgressBar counts={counts()} mode={mode} />
        </div>
        {lastError && (
          <div className="text-sm text-destructive mt-1">{lastError}</div>
        )}
      </header>

      {searchOpen && <SearchBar onClose={() => setSearchOpen(false)} />}

      {/* Main content */}
      <main className="p-4">
        <div className="max-w-6xl mx-auto">
          <PromptHeader record={leftRecord} format={format} showWhitespace={showWhitespace} />
        </div>
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
                  status={decisions.get(leftRef)?.status}
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
                leftStatus={decisions.get(leftRef)?.status}
                rightStatus={decisions.get(rightRef)?.status}
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
            status={decisions.get(leftRef)?.status}
          />
        ) : (
          <div className="text-center text-muted-foreground">Loading...</div>
        )}

        {/* Navigation info */}
        <div className="mt-4 text-center text-sm text-muted-foreground">
          {mode === 'compare'
            ? `Prompt ${cursor + 1} of ${source.index.groupCount}`
            : `Record ${cursor + 1} of ${source.index.lineCount}`}
        </div>

        {metadataOpen && (
          <div className="max-w-6xl mx-auto">
            <MetadataPanel
              record={!singleCard && focus === 1 ? rightRecord : leftRecord}
              format={format}
            />
          </div>
        )}
      </main>

      <ExportPanel open={exportOpen} onOpenChange={setExportOpen} />
      <LabelNotesPanel
        open={labelNotes !== null}
        onOpenChange={(open) => !open && setLabelNotes(null)}
        candidateRef={getFocusedRef()}
        focusField={labelNotes ?? 'labels'}
      />
      <GoToDialog
        open={goToOpen}
        onOpenChange={setGoToOpen}
        mode={mode}
        total={mode === 'compare' ? source.index.groupCount : source.index.lineCount}
      />
      {/* Cheat sheet dialog */}
      <CheatSheet open={cheatSheetOpen} onOpenChange={setCheatSheetOpen} />

      {/* Schema mapper dialog, a fresh copy per file so its fields start from that file's format (D-044) */}
      <SchemaMapper
        key={fingerprint}
        open={schemaMapperOpen}
        onOpenChange={setSchemaMapperOpen}
        onDraftChange={() => setMapperDraft(true)}
        currentFormat={format}
        sampleRecords={sampleRecords}
        onApply={handleSchemaMapperApply}
      />
    </div>,
    false
  );
}

export default App;
