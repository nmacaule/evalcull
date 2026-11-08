/**
 * Central hotkey registry using react-hotkeys-hook.
 * WP 6a: Mode-aware bindings, respects form field focus.
 * WP 6b: the panel keys M, L, N, G and / (PRD §2.2).
 */

import { useHotkeys as useHotkeysHook } from 'react-hotkeys-hook';
import { useCallback } from 'react';
import type { CandidateRef } from '../types';
import type { Preference, DecisionStatus } from '../types';
import { HOTKEY_TABLE } from '../lib/hotkeyTable';

export interface HotkeyHandlers {
  // Preference actions
  prefer: (p: Preference, strength?: 1 | 2 | 3) => void;
  setStrength: (s: 1 | 2 | 3) => void;

  // Decision actions
  decide: (ref: CandidateRef, status: DecisionStatus) => void;
  getFocusedRef: () => CandidateRef;

  // Navigation
  next: () => void;
  prev: () => void;
  toggleFocus: () => void;

  // Edit actions
  openEditor: () => void;
  saveEditor: () => void;
  cancelEditor: () => void;

  // Edit confirmation (decision i)
  editConfirmKeep: () => void;
  editConfirmDiscard: () => void;
  isEditConfirmOpen: boolean;

  // Undo/redo
  undo: () => void;
  redo: () => void;

  // View toggles
  toggleRaw: () => void;
  toggleWhitespace: () => void;
  /** Z, the reading step (PRD §2.2, O7) */
  toggleReadingStep: () => void;
  cycleFilter: () => void;
  showCheatSheet: () => void;

  // Scroll
  scrollUp: () => void;
  scrollDown: () => void;

  // Panels (WP 6b)
  toggleMetadata?: () => void;
  openLabels?: () => void;
  openNotes?: () => void;
  openGoTo?: () => void;
  openSearch?: () => void;

  // Mode and state
  mode: 'compare' | 'single';
  groupSize: number;
  isModalOpen: boolean;
  isEditorOpen: boolean;
  /** E is held until the focused record arrives; Esc cancels it (DR-012) */
  isEditPending?: boolean;
  /** Single-key shortcuts on (DR-029, WCAG 2.2 SC 2.1.4); arrows, Tab, Esc and Mod+Enter stay on */
  characterKeys?: boolean;
}

/**
 * Hook that registers all hotkeys.
 * Must be called at the top level of a component.
 */
export function useHotkeys(handlers: HotkeyHandlers): void {
  const {
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
    editConfirmKeep,
    editConfirmDiscard,
    isEditConfirmOpen,
    undo,
    redo,
    toggleRaw,
    toggleWhitespace,
    toggleReadingStep,
    cycleFilter,
    showCheatSheet,
    scrollUp,
    scrollDown,
    toggleMetadata,
    openLabels,
    openNotes,
    openGoTo,
    openSearch,
    mode,
    groupSize,
    isModalOpen,
    characterKeys = true,
    isEditorOpen,
    isEditPending = false,
  } = handlers;

  // Helper to check if hotkey should fire
  const shouldFire = useCallback(
    (entry: (typeof HOTKEY_TABLE)[0]): boolean => {
      // Don't fire if modal is open
      if (isModalOpen) return false;

      // Check mode
      if (entry.modes.includes('both')) return true;
      if (entry.modes.includes(mode)) return true;
      return false;
    },
    [isModalOpen, mode]
  );

  // Preference keys (compare mode only)
  // Left arrow: edit confirm discard OR prefer left
  useHotkeysHook(
    'left',
    () => {
      // Edit confirmation takes priority (decision i)
      if (isEditConfirmOpen) {
        editConfirmDiscard();
        return;
      }
      if (!shouldFire(HOTKEY_TABLE[0])) return;
      if (groupSize <= 1) return; // one-candidate groups: no-op
      prefer('left');
    },
    { enableOnFormTags: false }
  );

  useHotkeysHook(
    '1',
    () => {
      if (isEditConfirmOpen) return;
      if (!shouldFire(HOTKEY_TABLE[0])) return;
      if (groupSize <= 1) return;
      prefer('left');
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  // Right arrow: edit confirm keep OR prefer right
  useHotkeysHook(
    'right',
    () => {
      // Edit confirmation takes priority (decision i)
      if (isEditConfirmOpen) {
        editConfirmKeep();
        return;
      }
      if (!shouldFire(HOTKEY_TABLE[1])) return;
      if (groupSize <= 1) return;
      prefer('right');
    },
    { enableOnFormTags: false }
  );

  useHotkeysHook(
    '2',
    () => {
      if (isEditConfirmOpen) return;
      if (!shouldFire(HOTKEY_TABLE[1])) return;
      if (groupSize <= 1) return;
      prefer('right');
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    '=, 0',
    () => {
      if (!shouldFire(HOTKEY_TABLE[2])) return;
      if (groupSize <= 1) return;
      prefer('tie');
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'x',
    () => {
      if (!shouldFire(HOTKEY_TABLE[3])) return;
      if (groupSize <= 1) return;
      prefer('both_bad');
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  // Preference strength: attached to the pair just judged (v3.3, WP 6c decision f)
  useHotkeysHook(
    'shift+1',
    () => {
      if (!shouldFire(HOTKEY_TABLE[4])) return;
      setStrength(1);
    },
    { enabled: characterKeys, enableOnFormTags: false }
  );

  useHotkeysHook(
    'shift+2',
    () => {
      if (!shouldFire(HOTKEY_TABLE[5])) return;
      setStrength(2);
    },
    { enabled: characterKeys, enableOnFormTags: false }
  );

  useHotkeysHook(
    'shift+3',
    () => {
      if (!shouldFire(HOTKEY_TABLE[6])) return;
      setStrength(3);
    },
    { enabled: characterKeys, enableOnFormTags: false }
  );

  // Decision keys
  useHotkeysHook(
    'a',
    () => {
      if (isModalOpen) return;
      decide(getFocusedRef(), 'kept');
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'r',
    () => {
      if (isModalOpen) return;
      decide(getFocusedRef(), 'rejected');
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    's',
    () => {
      if (isModalOpen) return;
      decide(getFocusedRef(), 'skipped');
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  // Navigation
  useHotkeysHook(
    'tab',
    (e) => {
      if (isModalOpen || mode !== 'compare') return;
      // Reserved for candidate focus only with two cards to switch between (DR-023 as amended,
      // owner, 7 Nov 2026); with one card Tab moves DOM focus as usual
      if (groupSize <= 1) return;
      e.preventDefault();
      toggleFocus();
    },
    { enableOnFormTags: false }
  );

  useHotkeysHook(
    'j',
    () => {
      if (isModalOpen) return;
      next();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'k',
    () => {
      if (isModalOpen) return;
      prev();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'up',
    () => {
      if (isModalOpen) return;
      scrollUp();
    },
    { enableOnFormTags: false }
  );

  useHotkeysHook(
    'down',
    () => {
      if (isModalOpen) return;
      scrollDown();
    },
    { enableOnFormTags: false }
  );

  // Edit actions; preventDefault, as for the panel keys below, so the letter does not
  // type into the textarea the editor focuses as it opens (D-090)
  useHotkeysHook(
    'e',
    (e) => {
      if (isModalOpen) return;
      e.preventDefault();
      openEditor();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'mod+enter',
    () => {
      if (!isEditorOpen) return;
      saveEditor();
    },
    { enableOnFormTags: ['textarea'] } // PRD §3.10 (D-027)
  );

  useHotkeysHook(
    'escape',
    () => {
      // Esc cancels the editor, and dismisses the edit confirmation as its
      // Dismiss (Esc) button does, keeping the edit (WP 6a i, D-093); it also
      // cancels an E held for a record still loading (DR-012)
      if (isEditorOpen || isEditConfirmOpen || isEditPending) {
        cancelEditor();
      }
    },
    { enableOnFormTags: ['textarea'] } // PRD §3.10 (D-027)
  );

  // Undo/redo
  useHotkeysHook(
    'u',
    () => {
      if (isModalOpen) return;
      undo();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'shift+u',
    () => {
      if (isModalOpen) return;
      redo();
    },
    { enabled: characterKeys, enableOnFormTags: false }
  );

  // View toggles
  useHotkeysHook(
    't',
    () => {
      if (isModalOpen) return;
      toggleRaw();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'w',
    () => {
      if (isModalOpen) return;
      toggleWhitespace();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'z',
    () => {
      if (isModalOpen) return;
      toggleReadingStep();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'f',
    () => {
      if (isModalOpen) return;
      cycleFilter();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  // Note: shifted characters with useKey require explicit modifier (react-hotkeys-hook 5.3.3)
  useHotkeysHook(
    'shift+?',
    () => {
      if (isModalOpen) return;
      showCheatSheet();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  // Panel hotkeys (WP 6b); preventDefault so the key does not type into the
  // field the panel focuses as it opens
  useHotkeysHook(
    'm',
    () => {
      if (isModalOpen) return;
      toggleMetadata?.();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'l',
    (e) => {
      if (isModalOpen) return;
      e.preventDefault();
      openLabels?.();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'n',
    (e) => {
      if (isModalOpen) return;
      e.preventDefault();
      openNotes?.();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    'g',
    (e) => {
      if (isModalOpen) return;
      e.preventDefault();
      openGoTo?.();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );

  useHotkeysHook(
    '/',
    (e) => {
      if (isModalOpen) return;
      e.preventDefault();
      openSearch?.();
    },
    { enabled: characterKeys, enableOnFormTags: false, useKey: true }
  );
}

