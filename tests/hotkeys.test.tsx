/**
 * Hotkey tests for WP 6a.
 * Oracle: HOTKEY_TABLE from lib/hotkeyTable.ts (transcribed from PRD §2.2).
 * Tests that each key fires the corresponding action in the correct mode.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { getTestableHotkeys } from './helpers/hotkeys';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import App from '../src/App';
import type { RecordFormat } from '../src/types';
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

// The cheat sheet's own instruction (WP 7d, D-111): the key its closing line names
// must close it. Remedy-neutral: the test reads the key from the line, so it holds
// whether DR-033 rules that ? closes the sheet or that the line names Esc.
describe('the cheat sheet (WP 7d)', () => {
  beforeEach(() => {
    resetStore();
  });

  // The keys the line can name, as a keydown on the page
  const KEY_PRESS: Record<string, () => void> = {
    '?': () => press('?', 'Slash', { shiftKey: true }),
    Esc: () => press('Escape', 'Escape'),
    Escape: () => press('Escape', 'Escape'),
  };

  // Control for D-111: the harness sees the dialog close, so a failure above is the key's
  it('Esc closes the cheat sheet', async () => {
    const source = appSource(['{"instruction":"q","output":"a"}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));

    press('?', 'Slash', { shiftKey: true });
    await screen.findByRole('dialog');
    press('Escape', 'Escape');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the key the cheat sheet names closes it (D-111)', async () => {
    const source = appSource(['{"instruction":"q","output":"a"}'], [0], [1]);
    await loadSource(source, FLAT_IO);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));

    press('?', 'Slash', { shiftKey: true });
    const dialog = await screen.findByRole('dialog');
    // The key the closing line names: "… Esc closes it." (DR-033), or the earlier "Press ? to toggle …"
    const CLOSES = /(\?|Esc|Escape) closes it\.$|^Press (\S+) to toggle/;
    const line = [...dialog.querySelectorAll('div, p')]
      .map((el) => (el.textContent ?? '').trim())
      .find((text) => CLOSES.test(text));
    expect(line).toBeDefined();
    const match = line!.match(CLOSES)!;
    const named = match[1] ?? match[2];
    expect(Object.keys(KEY_PRESS)).toContain(named);

    KEY_PRESS[named]();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// WCAG 2.2 SC 2.1.4 (WP 7d, D-102, DR-029): the single-key switch in the keyboard shortcuts
// list turns every character-key shortcut off. Each key runs on a fixture where it acts, and
// the same key with the switch on (its default) is the positive control.
describe('the single-key switch (WP 7d)', () => {
  beforeEach(() => {
    resetStore();
  });

  // Two prompts of three in-record candidates: compare mode, text with a space and a line end
  const COMPARE_LINES = [
    '{"prompt":"first prompt","candidates":["first answer\\nnext line","second answer","third answer"]}',
    '{"prompt":"second prompt","candidates":["a b","c d","e f"]}',
  ];
  const CANDIDATES_FORMAT: RecordFormat = { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'candidates' };
  const FLAT_LINES = ['{"instruction":"q one","output":"a one"}', '{"instruction":"q two","output":"a two"}'];

  const state = () => useReviewStore.getState();
  const compareOf = () => state().decisions.get('0')?.compare ?? [];

  interface Case {
    key: string;
    mode: 'compare' | 'single';
    /** State the key needs, set through the store, not through keys */
    setup?: () => void;
    /** The key's own effect, written by hand */
    acted: (c: HTMLElement) => boolean;
  }
  const CASES: Case[] = [
    { key: '1', mode: 'compare', acted: () => compareOf()[0]?.preference === 'left' },
    { key: '2', mode: 'compare', acted: () => compareOf()[0]?.preference === 'right' },
    { key: '=', mode: 'compare', acted: () => compareOf()[0]?.preference === 'tie' },
    { key: '0', mode: 'compare', acted: () => compareOf()[0]?.preference === 'tie' },
    { key: 'x', mode: 'compare', acted: () => compareOf()[0]?.preference === 'both_bad' },
    { key: 'Shift+1', mode: 'compare', setup: () => state().prefer('left'), acted: () => compareOf()[0]?.strength === 1 },
    { key: 'Shift+2', mode: 'compare', setup: () => state().prefer('left'), acted: () => compareOf()[0]?.strength === 2 },
    { key: 'Shift+3', mode: 'compare', setup: () => state().prefer('left'), acted: () => compareOf()[0]?.strength === 3 },
    { key: 'a', mode: 'compare', acted: () => state().decisions.get('0:0')?.status === 'kept' },
    { key: 'r', mode: 'compare', acted: () => state().decisions.get('0:0')?.status === 'rejected' },
    { key: 's', mode: 'compare', acted: () => state().decisions.get('0:0')?.status === 'skipped' },
    { key: 'a', mode: 'single', acted: () => state().decisions.get('0')?.status === 'kept' },
    { key: 'r', mode: 'single', acted: () => state().decisions.get('0')?.status === 'rejected' },
    { key: 's', mode: 'single', acted: () => state().decisions.get('0')?.status === 'skipped' },
    { key: 'j', mode: 'compare', acted: () => state().cursor === 1 },
    { key: 'k', mode: 'compare', acted: () => state().cursor === 1 },
    { key: 'e', mode: 'compare', acted: () => screen.queryByLabelText('Edit content') !== null },
    { key: 'e', mode: 'single', acted: () => screen.queryByLabelText('Edit content') !== null },
    { key: 'u', mode: 'compare', setup: () => state().decide('0:0', 'kept'), acted: () => state().decisions.get('0:0')?.status !== 'kept' },
    {
      key: 'Shift+u',
      mode: 'compare',
      setup: () => {
        state().decide('0:0', 'kept');
        state().undo();
      },
      acted: () => state().decisions.get('0:0')?.status === 'kept',
    },
    { key: 't', mode: 'compare', acted: (c) => (card(c, '0:0').textContent ?? '').includes('"candidates":') },
    // The whitespace marks themselves: the header's counts contain "·" in every state
    { key: 'w', mode: 'compare', acted: (c) => card(c, '0:0').querySelector('[data-ws-mark]') !== null },
    { key: 'z', mode: 'compare', acted: () => document.documentElement.hasAttribute('data-reading-step') },
    { key: 'f', mode: 'compare', acted: () => state().filter !== 'all' },
    { key: '?', mode: 'compare', acted: () => screen.queryByRole('dialog') !== null },
    { key: 'm', mode: 'compare', acted: () => screen.queryByRole('region', { name: 'Metadata' }) !== null },
    { key: 'l', mode: 'compare', acted: () => screen.queryByRole('dialog') !== null },
    { key: 'n', mode: 'compare', acted: () => screen.queryByRole('dialog') !== null },
    { key: 'g', mode: 'compare', acted: () => screen.queryByRole('dialog') !== null },
    { key: '/', mode: 'compare', acted: () => screen.queryByRole('textbox', { name: 'Search' }) !== null },
  ];

  // Each case from a fresh store, a fresh switch (on) and no reading step
  async function open(mode: 'compare' | 'single') {
    resetStore();
    localStorage.clear();
    document.documentElement.removeAttribute('data-reading-step');
    if (mode === 'compare') await loadSource(appSource(COMPARE_LINES, [0, 1], [3, 3]), CANDIDATES_FORMAT);
    else await loadSource(appSource(FLAT_LINES, [0, 1], [1, 1]), FLAT_IO);
    const view = render(<App />);
    await waitFor(() => expect(card(view.container, mode === 'compare' ? '0:0' : '0').textContent).toContain('a'));
    expect(state().mode).toBe(mode);
    return view;
  }

  async function turnOff() {
    fireEvent.click(screen.getByRole('button', { name: /Keyboard shortcuts/ }));
    const toggle = await screen.findByLabelText('Single-key shortcuts');
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    press('Escape', 'Escape');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }

  // Explicit timeout (owner, 7 Nov 2026): 30 App renders; alone 2,370 ms (off) and 588 ms (control),
  // over the 5,000 ms default when the full suite runs in parallel. Assertions unchanged.
  it('with the switch off, the arrows, Tab, Esc and Mod+Enter still act (DR-029)', async () => {
    let view = await open('compare');
    await turnOff();
    press('ArrowLeft', 'ArrowLeft');
    await act(async () => {});
    expect(compareOf()[0]?.preference).toBe('left');
    view.unmount();

    view = await open('compare');
    await turnOff();
    expect(fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' })).toBe(false);
    expect(state().focus).toBe(1);
    view.unmount();

    // The editor through its visible control, then Mod+Enter saves and Esc dismisses the confirmation
    view = await open('single');
    await turnOff();
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }));
    const editor = (await screen.findByLabelText('Edit content')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'changed' } });
    press('Enter', 'Enter', { metaKey: true, ctrlKey: true }, editor);
    expect(await screen.findByRole('heading', { name: 'Confirm Edit' })).toBeInTheDocument();
    press('Escape', 'Escape');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Confirm Edit' })).toBeNull());
    view.unmount();
  }, 30_000);

  it('with character-key shortcuts turned off, no character key acts (D-102)', async () => {
    const acted: string[] = [];
    for (const c of CASES) {
      const view = await open(c.mode);
      await turnOff();
      c.setup?.();
      pressKey(c.key);
      // The same single flush as the control below, so a key the control shows acting here would show
      await act(async () => {});
      if (c.acted(view.container)) acted.push(`${c.key} (${c.mode})`);
      view.unmount();
    }
    expect(acted).toEqual([]);
  }, 30_000);

  // Explicit timeout (owner, 7 Nov 2026): 30 App renders; alone 2,370 ms (off) and 588 ms (control),
  // over the 5,000 ms default when the full suite runs in parallel. Assertions unchanged.
  it('with the switch on, its default, each character key acts on the same fixture (control for D-102)', async () => {
    const idle: string[] = [];
    for (const c of CASES) {
      const view = await open(c.mode);
      c.setup?.();
      pressKey(c.key);
      await act(async () => {});
      if (!c.acted(view.container)) idle.push(`${c.key} (${c.mode})`);
      view.unmount();
    }
    expect(idle).toEqual([]);
  }, 30_000);
});

// DR-023 as amended (owner, 7 Nov 2026): in compare mode Tab is reserved for candidate focus
// only when there are two cards to switch between; with one card it moves DOM focus normally
describe('Tab with one card (WP 7d, DR-023 amendment)', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });
  const CANDIDATES_FORMAT: RecordFormat = { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'candidates' };

  it('on a one-candidate prompt, Tab is left to the browser', async () => {
    await loadSource(
      appSource(['{"prompt":"p","candidates":["only"]}', '{"prompt":"q","candidates":["a","b"]}'], [0, 1], [1, 2]),
      CANDIDATES_FORMAT
    );
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0:0').textContent).toContain('only'));
    expect(useReviewStore.getState().mode).toBe('compare');
    // fireEvent returns false when a handler called preventDefault
    expect(fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' })).toBe(true);
  });

  it('on a two-candidate prompt, Tab still switches the cards and keeps the browser out (control)', async () => {
    await loadSource(appSource(['{"prompt":"q","candidates":["a","b"]}'], [0], [2]), CANDIDATES_FORMAT);
    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0:1').textContent).toContain('b'));
    expect(fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' })).toBe(false);
    expect(useReviewStore.getState().focus).toBe(1);
  });
});
