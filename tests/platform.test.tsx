/**
 * Key names for the user's platform (WP 7d, DR-035 as amended 7 Nov 2026): ⌘ Return on
 * Apple platforms, Ctrl+Enter elsewhere; aria-keyshortcuts in the UI Events names,
 * Meta+Enter or Control+Enter. Oracle: the strings below, written by hand from the ruling.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { keyLabel, keyShortcut } from '../src/lib/platform';
import { Editor } from '../src/components/Editor';
import { CheatSheet } from '../src/components/CheatSheet';
import { LabelNotesPanel } from '../src/components/LabelNotesPanel';

function onPlatform(platform: string) {
  vi.stubGlobal('navigator', { ...navigator, platform });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('key names per platform (DR-035)', () => {
  it.each([
    ['MacIntel', 'mod+enter', '⌘ Return', 'Meta+Enter'],
    ['iPhone', 'mod+enter', '⌘ Return', 'Meta+Enter'],
    ['Win32', 'mod+enter', 'Ctrl+Enter', 'Control+Enter'],
    ['Linux x86_64', 'mod+enter', 'Ctrl+Enter', 'Control+Enter'],
    ['MacIntel', 'Shift+u', '⇧U', 'Shift+U'],
    ['Win32', 'Shift+u', 'Shift+U', 'Shift+U'],
    ['MacIntel', 'Shift+1', '⇧1', 'Shift+1'],
    ['Win32', 'Shift+1', 'Shift+1', 'Shift+1'],
    ['Win32', 'ArrowLeft', '←', 'ArrowLeft'],
    ['Win32', 'Escape', 'Esc', 'Escape'],
    ['Win32', 'Tab', 'Tab', 'Tab'],
    ['Win32', 'a', 'A', 'A'],
    ['MacIntel', '?', '?', '?'],
    ['MacIntel', '/', '/', '/'],
  ])('on %s, %s shows as %s and is exposed as %s', (platform, key, label, aria) => {
    onPlatform(platform);
    expect(keyLabel(key)).toBe(label);
    expect(keyShortcut(key)).toBe(aria);
  });

  it.each([
    ['MacIntel', '⌘ Return to save'],
    ['Win32', 'Ctrl+Enter to save'],
  ])('the editor on %s says %s', (platform, hint) => {
    onPlatform(platform);
    render(<Editor initialValue="x" onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.queryByText(/Mod\+Enter/)).toBeNull();
  });

  it.each([
    ['MacIntel', '⌘ Return saves'],
    ['Win32', 'Ctrl+Enter saves'],
  ])('the labels and notes dialog on %s says %s', (platform, hint) => {
    onPlatform(platform);
    render(<LabelNotesPanel open={true} onOpenChange={() => {}} candidateRef="0" focusField="labels" />);
    expect(screen.getByText(new RegExp(hint.replace('+', '\\+')))).toBeInTheDocument();
    expect(screen.queryByText(/Mod\+Enter/)).toBeNull();
  });

  it.each([
    ['MacIntel', '⌘ Return'],
    ['Win32', 'Ctrl+Enter'],
  ])('the cheat sheet keycap for saving on %s reads %s', (platform, keycap) => {
    onPlatform(platform);
    render(<CheatSheet open={true} onOpenChange={() => {}} />);
    expect(document.querySelector('[data-hotkey="mod+enter"] kbd')!.textContent).toBe(keycap);
  });
});

describe('the shortcuts list, as ruled 7 Nov 2026', () => {
  it.each([
    ['MacIntel', 'When on, letters, numbers and symbols such as ? work as shortcuts. Arrows, Tab, Esc and ⌘ Return always work.'],
    ['Win32', 'When on, letters, numbers and symbols such as ? work as shortcuts. Arrows, Tab, Esc and Ctrl+Enter always work.'],
  ])('on %s the switch is described as %s', (platform, text) => {
    onPlatform(platform);
    render(<CheatSheet open={true} onOpenChange={() => {}} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows letter keys in capitals, as the action bar does', () => {
    onPlatform('Win32');
    render(<CheatSheet open={true} onOpenChange={() => {}} />);
    expect(document.querySelector('[data-hotkey="a"] kbd')!.textContent).toBe('A');
    expect(document.querySelector('[data-hotkey="/"] kbd')!.textContent).toBe('/');
  });
});
