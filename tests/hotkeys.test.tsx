/**
 * Hotkey tests for WP 6a.
 * Oracle: HOTKEY_TABLE from lib/hotkeyTable.ts (transcribed from PRD §2.2).
 * Tests that each key fires the corresponding action in the correct mode.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { getTestableHotkeys } from '../src/lib/hotkeyTable';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

beforeEach(() => {
  // Fresh IDB per test
  configureStorage({ indexedDB: new IDBFactory() });
  configureSidecar(null);

  // Reset store to initial state
  useReviewStore.setState({
    source: null,
    sourceName: '',
    fingerprint: '',
    format: { kind: 'unknown' },
    decisions: new Map(),
    mode: 'single',
    cursor: 0,
    focus: 0,
    past: [],
    future: [],
    filter: 'all',
    storageState: { kind: 'idle' },
    lastSavedAt: null,
    session: { kind: 'fresh' },
    newerLocalCopy: null,
    _dirty: false,
    _lastSerializedText: null,
  });
});

// -----------------------------------------------------------------------------
// Test component that uses hotkeys
// -----------------------------------------------------------------------------

import { useHotkeys, type HotkeyHandlers } from '../src/hooks/useHotkeys';

interface TestHarnessProps {
  mode: 'compare' | 'single';
  groupSize?: number;
  isModalOpen?: boolean;
  isEditorOpen?: boolean;
  isEditConfirmOpen?: boolean;
  handlers?: Partial<HotkeyHandlers>;
}

function TestHarness({
  mode,
  groupSize = 2,
  isModalOpen = false,
  isEditorOpen = false,
  isEditConfirmOpen = false,
  handlers = {},
}: TestHarnessProps) {
  const defaultHandlers: HotkeyHandlers = {
    prefer: vi.fn(),
    setStrength: vi.fn(),
    decide: vi.fn(),
    getFocusedRef: vi.fn(() => '0'),
    next: vi.fn(),
    prev: vi.fn(),
    toggleFocus: vi.fn(),
    openEditor: vi.fn(),
    saveEditor: vi.fn(),
    cancelEditor: vi.fn(),
    editConfirmKeep: vi.fn(),
    editConfirmDiscard: vi.fn(),
    isEditConfirmOpen,
    undo: vi.fn(),
    redo: vi.fn(),
    toggleRaw: vi.fn(),
    toggleWhitespace: vi.fn(),
    cycleFilter: vi.fn(),
    showCheatSheet: vi.fn(),
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
    mode,
    groupSize,
    isModalOpen,
    isEditorOpen,
    ...handlers,
  };

  useHotkeys(defaultHandlers);

  return (
    <div data-testid="test-harness">
      <input data-testid="form-input" type="text" />
      <textarea data-testid="form-textarea" />
      <button data-testid="button">Click me</button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Helper to dispatch keyboard events
// -----------------------------------------------------------------------------

function pressKey(key: string, target?: HTMLElement) {
  const el = target ?? document.body;

  // Parse modifiers
  const parts = key.toLowerCase().split('+');
  const mainKey = parts[parts.length - 1];
  let hasShift = parts.includes('shift');
  const hasMod = parts.includes('mod');
  const hasCtrl = parts.includes('ctrl');
  const hasAlt = parts.includes('alt');

  // Map key names
  let code = mainKey;
  let keyValue = mainKey;

  if (mainKey === 'arrowleft') { code = 'ArrowLeft'; keyValue = 'ArrowLeft'; }
  else if (mainKey === 'arrowright') { code = 'ArrowRight'; keyValue = 'ArrowRight'; }
  else if (mainKey === 'arrowup') { code = 'ArrowUp'; keyValue = 'ArrowUp'; }
  else if (mainKey === 'arrowdown') { code = 'ArrowDown'; keyValue = 'ArrowDown'; }
  else if (mainKey === 'tab') { code = 'Tab'; keyValue = 'Tab'; }
  else if (mainKey === 'escape') { code = 'Escape'; keyValue = 'Escape'; }
  else if (mainKey === 'enter') { code = 'Enter'; keyValue = 'Enter'; }
  else if (mainKey === '=') { code = 'Equal'; keyValue = '='; }
  else if (mainKey === '?') { code = 'Slash'; keyValue = '?'; hasShift = true; }
  else if (mainKey === '/') { code = 'Slash'; keyValue = '/'; }
  else if (/^\d$/.test(mainKey)) { code = `Digit${mainKey}`; keyValue = mainKey; }
  else if (/^[a-z]$/.test(mainKey)) { code = `Key${mainKey.toUpperCase()}`; keyValue = mainKey; }

  fireEvent.keyDown(el, {
    key: keyValue,
    code,
    shiftKey: hasShift,
    ctrlKey: hasCtrl || hasMod,
    metaKey: hasMod,
    altKey: hasAlt,
  });
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('hotkeys', () => {
  const testableHotkeys = getTestableHotkeys();

  describe('key bindings fire actions', () => {
    // Group by action for cleaner test output
    const preferenceKeys = testableHotkeys.filter(h => h.action === 'prefer');
    const strengthKeys = testableHotkeys.filter(h => h.action === 'setStrength');
    const decisionKeys = testableHotkeys.filter(h => h.action === 'decide');

    describe('preference keys (compare mode)', () => {
      it.each(preferenceKeys)('$key fires prefer($args)', (entry) => {
        const prefer = vi.fn();
        render(<TestHarness mode="compare" handlers={{ prefer }} />);

        pressKey(entry.key);
        expect(prefer).toHaveBeenCalledWith(entry.args![0]);
      });

      it.each(preferenceKeys.filter(h => h.altKey))('$altKey also fires prefer($args)', (entry) => {
        const prefer = vi.fn();
        render(<TestHarness mode="compare" handlers={{ prefer }} />);

        pressKey(entry.altKey!);
        expect(prefer).toHaveBeenCalledWith(entry.args![0]);
      });

      it('preference keys are no-op in single mode', () => {
        const prefer = vi.fn();
        render(<TestHarness mode="single" handlers={{ prefer }} />);

        pressKey('ArrowLeft');
        pressKey('ArrowRight');
        pressKey('=');
        pressKey('x');

        expect(prefer).not.toHaveBeenCalled();
      });

      it('preference keys are no-op with groupSize <= 1', () => {
        const prefer = vi.fn();
        render(<TestHarness mode="compare" groupSize={1} handlers={{ prefer }} />);

        pressKey('ArrowLeft');
        pressKey('ArrowRight');

        expect(prefer).not.toHaveBeenCalled();
      });
    });

    describe('strength keys (compare mode)', () => {
      // WP 6c decision f: Shift+1–3 attach strength to the pair just judged
      it.each(strengthKeys)('$key fires setStrength($args)', (entry) => {
        const setStrength = vi.fn();
        const prefer = vi.fn();
        const prev = vi.fn();
        render(<TestHarness mode="compare" handlers={{ setStrength, prefer, prev }} />);

        pressKey(entry.key);
        expect(setStrength).toHaveBeenCalledWith(entry.args![0]);
        expect(prefer).not.toHaveBeenCalled();
        expect(prev).not.toHaveBeenCalled();
      });

      it('strength keys are no-op in single mode', () => {
        const setStrength = vi.fn();
        render(<TestHarness mode="single" handlers={{ setStrength }} />);

        pressKey('Shift+1');
        pressKey('Shift+2');
        pressKey('Shift+3');
        expect(setStrength).not.toHaveBeenCalled();
      });
    });

    describe('decision keys (both modes)', () => {
      it.each(decisionKeys)('$key fires decide(ref, $args) in single mode', (entry) => {
        const decide = vi.fn();
        const getFocusedRef = vi.fn(() => '5');
        render(<TestHarness mode="single" handlers={{ decide, getFocusedRef }} />);

        pressKey(entry.key);
        expect(decide).toHaveBeenCalledWith('5', entry.args![0]);
      });

      it.each(decisionKeys)('$key fires decide(ref, $args) in compare mode', (entry) => {
        const decide = vi.fn();
        const getFocusedRef = vi.fn(() => '3:1');
        render(<TestHarness mode="compare" handlers={{ decide, getFocusedRef }} />);

        pressKey(entry.key);
        expect(decide).toHaveBeenCalledWith('3:1', entry.args![0]);
      });
    });

    describe('navigation keys', () => {
      it('j fires next()', () => {
        const next = vi.fn();
        render(<TestHarness mode="single" handlers={{ next }} />);

        pressKey('j');
        expect(next).toHaveBeenCalled();
      });

      it('k fires prev()', () => {
        const prev = vi.fn();
        render(<TestHarness mode="single" handlers={{ prev }} />);

        pressKey('k');
        expect(prev).toHaveBeenCalled();
      });

      it('Tab fires toggleFocus() in compare mode', () => {
        const toggleFocus = vi.fn();
        render(<TestHarness mode="compare" handlers={{ toggleFocus }} />);

        pressKey('Tab');
        expect(toggleFocus).toHaveBeenCalled();
      });

      it('Tab does not fire toggleFocus() in single mode', () => {
        const toggleFocus = vi.fn();
        render(<TestHarness mode="single" handlers={{ toggleFocus }} />);

        pressKey('Tab');
        expect(toggleFocus).not.toHaveBeenCalled();
      });

      it('ArrowUp fires scrollUp()', () => {
        const scrollUp = vi.fn();
        render(<TestHarness mode="single" handlers={{ scrollUp }} />);

        pressKey('ArrowUp');
        expect(scrollUp).toHaveBeenCalled();
      });

      it('ArrowDown fires scrollDown()', () => {
        const scrollDown = vi.fn();
        render(<TestHarness mode="single" handlers={{ scrollDown }} />);

        pressKey('ArrowDown');
        expect(scrollDown).toHaveBeenCalled();
      });
    });

    describe('edit keys', () => {
      it('e fires openEditor()', () => {
        const openEditor = vi.fn();
        render(<TestHarness mode="single" handlers={{ openEditor }} />);

        pressKey('e');
        expect(openEditor).toHaveBeenCalled();
      });

      it('Mod+Enter fires saveEditor() when editor is open', () => {
        const saveEditor = vi.fn();
        render(<TestHarness mode="single" isEditorOpen={true} handlers={{ saveEditor }} />);

        pressKey('mod+enter');
        expect(saveEditor).toHaveBeenCalled();
      });

      it('Mod+Enter does not fire when editor is closed', () => {
        const saveEditor = vi.fn();
        render(<TestHarness mode="single" isEditorOpen={false} handlers={{ saveEditor }} />);

        pressKey('mod+enter');
        expect(saveEditor).not.toHaveBeenCalled();
      });

      it('Escape fires cancelEditor() when editor is open', () => {
        const cancelEditor = vi.fn();
        render(<TestHarness mode="single" isEditorOpen={true} handlers={{ cancelEditor }} />);

        pressKey('Escape');
        expect(cancelEditor).toHaveBeenCalled();
      });
    });

    describe('undo/redo keys', () => {
      it('u fires undo()', () => {
        const undo = vi.fn();
        render(<TestHarness mode="single" handlers={{ undo }} />);

        pressKey('u');
        expect(undo).toHaveBeenCalled();
      });

      it('Shift+u fires redo()', () => {
        const redo = vi.fn();
        render(<TestHarness mode="single" handlers={{ redo }} />);

        pressKey('Shift+u');
        expect(redo).toHaveBeenCalled();
      });
    });

    describe('view toggle keys', () => {
      it('t fires toggleRaw()', () => {
        const toggleRaw = vi.fn();
        render(<TestHarness mode="single" handlers={{ toggleRaw }} />);

        pressKey('t');
        expect(toggleRaw).toHaveBeenCalled();
      });

      it('w fires toggleWhitespace()', () => {
        const toggleWhitespace = vi.fn();
        render(<TestHarness mode="single" handlers={{ toggleWhitespace }} />);

        pressKey('w');
        expect(toggleWhitespace).toHaveBeenCalled();
      });

      it('f fires cycleFilter()', () => {
        const cycleFilter = vi.fn();
        render(<TestHarness mode="single" handlers={{ cycleFilter }} />);

        pressKey('f');
        expect(cycleFilter).toHaveBeenCalled();
      });

      it('? fires showCheatSheet()', () => {
        const showCheatSheet = vi.fn();
        render(<TestHarness mode="single" handlers={{ showCheatSheet }} />);

        pressKey('?');
        expect(showCheatSheet).toHaveBeenCalled();
      });
    });
  });

  describe('form field blocking', () => {
    const nonFormHotkeys = testableHotkeys.filter(h => !h.firesInForm);

    it.each(nonFormHotkeys.slice(0, 5))('$key does not fire with focus in input', async (entry) => {
      // Use first few to avoid test explosion
      const handler = vi.fn();
      const handlers: Partial<HotkeyHandlers> = {};

      // Map action to handler
      if (entry.action === 'prefer') handlers.prefer = handler;
      else if (entry.action === 'decide') handlers.decide = handler;
      else if (entry.action === 'next') handlers.next = handler;
      else if (entry.action === 'prev') handlers.prev = handler;
      else if (entry.action === 'undo') handlers.undo = handler;

      render(<TestHarness mode="compare" handlers={handlers} />);

      const input = screen.getByTestId('form-input');
      input.focus();
      pressKey(entry.key, input);

      expect(handler).not.toHaveBeenCalled();
    });

    it('Mod+Enter fires even in textarea (form field)', () => {
      const saveEditor = vi.fn();
      render(<TestHarness mode="single" isEditorOpen={true} handlers={{ saveEditor }} />);

      const textarea = screen.getByTestId('form-textarea');
      textarea.focus();
      pressKey('mod+enter', textarea);

      expect(saveEditor).toHaveBeenCalled();
    });

    it('Escape fires even in textarea (form field)', () => {
      const cancelEditor = vi.fn();
      render(<TestHarness mode="single" isEditorOpen={true} handlers={{ cancelEditor }} />);

      const textarea = screen.getByTestId('form-textarea');
      textarea.focus();
      pressKey('Escape', textarea);

      expect(cancelEditor).toHaveBeenCalled();
    });
  });

  describe('modal blocking', () => {
    it('hotkeys do not fire when modal is open', () => {
      const prefer = vi.fn();
      const decide = vi.fn();
      const next = vi.fn();

      render(
        <TestHarness
          mode="compare"
          isModalOpen={true}
          handlers={{ prefer, decide, next }}
        />
      );

      pressKey('ArrowLeft');
      pressKey('a');
      pressKey('j');

      expect(prefer).not.toHaveBeenCalled();
      expect(decide).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('edit confirmation mode (decision i)', () => {
    it('← calls editConfirmDiscard and not prefer when isEditConfirmOpen', () => {
      const prefer = vi.fn();
      const editConfirmDiscard = vi.fn();
      render(
        <TestHarness
          mode="compare"
          isEditConfirmOpen={true}
          handlers={{ prefer, editConfirmDiscard }}
        />
      );

      pressKey('ArrowLeft');

      expect(editConfirmDiscard).toHaveBeenCalled();
      expect(prefer).not.toHaveBeenCalled();
    });

    it('→ calls editConfirmKeep and not prefer when isEditConfirmOpen', () => {
      const prefer = vi.fn();
      const editConfirmKeep = vi.fn();
      render(
        <TestHarness
          mode="compare"
          isEditConfirmOpen={true}
          handlers={{ prefer, editConfirmKeep }}
        />
      );

      pressKey('ArrowRight');

      expect(editConfirmKeep).toHaveBeenCalled();
      expect(prefer).not.toHaveBeenCalled();
    });
  });
});
