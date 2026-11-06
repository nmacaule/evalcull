/**
 * The dialog under the single file's hashed style-src (PRD §3.9, DR-008 option E):
 * opening it creates no style element, while the content keeps its focus trap
 * and hides the rest of the page from assistive technology.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

function Open() {
  return (
    <>
      <main data-testid="page">page</main>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
          <input aria-label="first" />
          <input aria-label="second" />
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Dialog (DR-008)', () => {
  it('creates no style element when it opens', () => {
    const before = document.querySelectorAll('style').length;
    render(<Open />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelectorAll('style').length).toBe(before);
  });

  it('renders a backdrop behind the content', () => {
    render(<Open />);
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop!.tagName).toBe('DIV');
  });

  it('keeps the focus trap and hides the page from assistive technology', () => {
    render(<Open />);
    expect(screen.getByTestId('page').closest('[aria-hidden="true"]')).not.toBeNull();
    // Close is the last tabbable element; Tab there wraps to the first, which only the
    // content's focus trap does (jsdom moves no focus by itself)
    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('first'));
  });
});
