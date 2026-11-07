/**
 * Hotkey tests for WP 6a.
 * Oracle: HOTKEY_TABLE from lib/hotkeyTable.ts (transcribed from PRD §2.2).
 * Tests that each key fires the corresponding action in the correct mode.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { getTestableHotkeys } from './helpers/hotkeys';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import App from '../src/App';
import {
  makeSource as appSource,
  press,
  loadSource,
  card,
  resetStore,
  FLAT_IO,
  MESSAGES,
} from './helpers/app';
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
    toggleReadingStep: vi.fn(),
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

      it("E prevents the key's default action, so the letter does not type into the editor (D-090)", () => {
        const openEditor = vi.fn();
        render(<TestHarness mode="single" handlers={{ openEditor }} />);

        // fireEvent returns false when a handler called preventDefault; the editor
        // focuses its textarea inside this keydown, so a default action would type e there
        const notPrevented = fireEvent.keyDown(document.body, { key: 'e', code: 'KeyE' });
        expect(openEditor).toHaveBeenCalled();
        expect(notPrevented).toBe(false);
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

      it('z fires toggleReadingStep() in both modes (PRD §2.2, O7)', () => {
        for (const mode of ['compare', 'single'] as const) {
          const toggleReadingStep = vi.fn();
          const { unmount } = render(<TestHarness mode={mode} handlers={{ toggleReadingStep }} />);
          pressKey('z');
          expect(toggleReadingStep).toHaveBeenCalledTimes(1);
          unmount();
        }
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

// -----------------------------------------------------------------------------
// App-level keys (WP 6b defects)
// -----------------------------------------------------------------------------

describe('App-level keys (WP 6b)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('ArrowDown scrolls the focused card by 40 px (D-019)', async () => {
    const source = appSource(
      [
        '{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"a"}]}',
        '{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"b"}]}',
      ],
      [0, 0],
      [1, 1]
    );
    await loadSource(source, MESSAGES);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '1').textContent).toContain('b'));
    const content = card(container, '0').querySelector('.overflow-auto') as HTMLElement;
    expect(content.scrollTop).toBe(0);

    press('ArrowDown', 'ArrowDown');

    expect(content.scrollTop).toBe(40);
    press('ArrowUp', 'ArrowUp');
    expect(content.scrollTop).toBe(0);
  });

  it('ArrowDown scrolls a flat card by 40 px too (D-019)', async () => {
    const source = appSource(
      ['{"instruction":"q","output":"a"}', '{"instruction":"q","output":"b"}'],
      [0, 0],
      [1, 1]
    );
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '1').textContent).toContain('b'));
    const content = card(container, '0').querySelector('[data-card-content]') as HTMLElement;

    press('ArrowDown', 'ArrowDown');

    expect(content.scrollTop).toBe(40);
  });

  it('F cycles through unparseable and back to all (D-021)', async () => {
    const source = appSource(['{"instruction":"q","output":"a"}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));

    for (let i = 0; i < 6; i++) press('f', 'KeyF');
    expect(useReviewStore.getState().filter).toBe('unparseable');
    press('f', 'KeyF');
    expect(useReviewStore.getState().filter).toBe('all');
  });
});

// The reading step (PRD §2.2 Z, §2.11, DR-016 O7): view state on the app root,
// never written to the session
describe('Z, the reading step (WP 7b)', () => {
  beforeEach(() => {
    resetStore();
  });

  // On the document root, so it reaches dialogs in their portal (O7)
  const readingStep = () => (document.documentElement.hasAttribute('data-reading-step') ? document.documentElement : null);

  it('Z toggles the reading step on the app root in compare mode', async () => {
    const source = appSource(
      [
        '{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"a"}]}',
        '{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"b"}]}',
      ],
      [0, 0],
      [1, 1]
    );
    await loadSource(source, MESSAGES);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '1').textContent).toContain('b'));
    expect(useReviewStore.getState().mode).toBe('compare');
    expect(readingStep()).toBeNull();

    press('z', 'KeyZ');
    expect(readingStep()).not.toBeNull();
    press('z', 'KeyZ');
    expect(readingStep()).toBeNull();
  });

  it('Z toggles the reading step in single mode', async () => {
    const source = appSource(['{"instruction":"q","output":"a"}', '{"instruction":"r","output":"b"}'], [0, 1], [1, 1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));
    expect(useReviewStore.getState().mode).toBe('single');

    press('z', 'KeyZ');
    expect(readingStep()).not.toBeNull();
    press('z', 'KeyZ');
    expect(readingStep()).toBeNull();
  });

  it('z typed in the editor does not toggle the reading step', async () => {
    const source = appSource(['{"instruction":"q","output":"a"}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));

    press('e', 'KeyE');
    const editor = await screen.findByLabelText('Edit content');
    press('z', 'KeyZ', {}, editor);
    expect(readingStep()).toBeNull();
  });

  it('Z does nothing while a dialog is open', async () => {
    const source = appSource(['{"instruction":"q","output":"a"}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));

    press('?', 'Slash', { shiftKey: true });
    await screen.findByRole('dialog');
    press('z', 'KeyZ');
    expect(readingStep()).toBeNull();
  });

  it('the reading step is not written to the session', async () => {
    const source = appSource(['{"instruction":"q","output":"a"}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));
    const before = useReviewStore.getState().exportSession();

    press('z', 'KeyZ');
    expect(readingStep()).not.toBeNull();

    expect(useReviewStore.getState()._dirty).toBe(false);
    expect(useReviewStore.getState().exportSession()).toBe(before);
    expect(before).not.toMatch(/reading/i);
  });
});
