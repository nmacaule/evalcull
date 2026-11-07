/**
 * WP 6b: opening a file by drop or the Open file button, through the shared
 * loadJsonlFile (D-004); a drop with a file open asks first (owner Q1).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dropzone } from '../src/components/Dropzone';

const loadJsonlFile = vi.fn();
vi.mock('../src/readers/loadJsonlFile', () => ({
  loadJsonlFile: (...args: unknown[]) => loadJsonlFile(...args),
}));

beforeEach(() => {
  loadJsonlFile.mockReset();
  loadJsonlFile.mockResolvedValue(undefined);
});

function drop(files: File[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  // A native window event: act flushes the state it sets before the assertions
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const file = (name: string) => new File(['{"a":1}\n'], name);

describe('Dropzone', () => {
  it('opens a dropped .jsonl file through loadJsonlFile', async () => {
    render(<Dropzone loaded={false} />);
    const f = file('a.jsonl');
    drop([f]);
    await waitFor(() => expect(loadJsonlFile).toHaveBeenCalledTimes(1));
    expect(loadJsonlFile.mock.calls[0][0]).toBe(f);
  });

  it("puts a refused drop's message in exactly one live region while a file is open", () => {
    render(<Dropzone loaded={true} />);
    drop([file('notes.txt')]);
    const message = screen.getByText('Only .jsonl files open in this version.');
    const regions: string[] = [];
    for (let el: HTMLElement | null = message; el; el = el.parentElement) {
      const role = el.getAttribute('role');
      if (role === 'status' || role === 'alert' || el.getAttribute('aria-live')) regions.push(role ?? 'aria-live');
    }
    expect(regions).toEqual(['alert']);
  });

  it('refuses another extension and more than one file', () => {
    render(<Dropzone loaded={false} />);
    drop([file('a.csv')]);
    expect(screen.getByText('Only .jsonl files open in this version.')).toBeInTheDocument();
    drop([file('a.jsonl'), file('b.jsonl')]);
    expect(screen.getByText('Drop one file at a time.')).toBeInTheDocument();
    expect(loadJsonlFile).not.toHaveBeenCalled();
  });

  it('has a focusable Open file button whose input accepts .jsonl, and keeps the heading', () => {
    render(<Dropzone loaded={false} />);
    const button = screen.getByRole('button', { name: 'Open file' });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(screen.getByLabelText('JSONL file').getAttribute('accept')).toBe('.jsonl');
    expect(screen.getByRole('heading', { name: 'evalcull' })).toBeInTheDocument();
  });

  it('shows the error of a load that fails', async () => {
    loadJsonlFile.mockRejectedValue(new Error('Worker failed'));
    render(<Dropzone loaded={false} />);
    drop([file('a.jsonl')]);
    await waitFor(() => expect(screen.getByText('Worker failed')).toBeInTheDocument());
  });

  // WP 7c (D-103 symptom): a rejected read reaches the alert and releases the opening
  // hold, so the next open goes through; the hang D-103 names is upstream of this
  it('a rejected read shows an alert and the next open goes through (D-103 symptom)', async () => {
    loadJsonlFile.mockRejectedValueOnce(new Error('The I/O read operation failed.'));
    render(<Dropzone loaded={false} />);
    drop([file('a.jsonl')]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The I/O read operation failed.'));
    drop([file('b.jsonl')]);
    await waitFor(() => expect(loadJsonlFile).toHaveBeenCalledTimes(2));
  });

  it('prevents the browser default on window dragover and drop, and stops after unmount', () => {
    const { unmount } = render(<Dropzone loaded={false} />);
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(drop([]).defaultPrevented).toBe(true);

    unmount();
    expect(drop([file('a.jsonl')]).defaultPrevented).toBe(false);
    expect(loadJsonlFile).not.toHaveBeenCalled();
  });

  it('asks before opening a dropped file while one is loaded (Q1)', async () => {
    render(<Dropzone loaded={true} />);
    const b = file('b.jsonl');

    drop([b]);
    expect(screen.getByText('Open b.jsonl? Changes to the current file are saved first.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(loadJsonlFile).not.toHaveBeenCalled();

    drop([b]);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(loadJsonlFile).toHaveBeenCalledTimes(1));
    expect(loadJsonlFile.mock.calls[0][0]).toBe(b);
  });

  it('Open sample: candidates loads candidates.jsonl (DR-010)', async () => {
    render(<Dropzone loaded={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open sample: candidates' }));
    await waitFor(() => expect(loadJsonlFile).toHaveBeenCalledTimes(1));
    const opened = loadJsonlFile.mock.calls[0][0] as File;
    expect(opened.name).toBe('candidates.jsonl');
    // 15 Nov 2026 00:00 UTC, fixed so the fingerprint restores a session across visits
    expect(opened.lastModified).toBe(1794700800000);
    const expected = readFileSync(join(import.meta.dirname, '..', 'samples', 'candidates.jsonl'), 'utf8');
    expect(await opened.text()).toBe(expected);
  });

  it('offers the three samples on the empty page only (DR-010)', () => {
    const { unmount } = render(<Dropzone loaded={false} />);
    for (const label of ['conversation', 'preference', 'candidates']) {
      expect(screen.getByRole('button', { name: `Open sample: ${label}` })).toBeInTheDocument();
    }
    unmount();
    render(<Dropzone loaded />);
    expect(screen.queryByRole('button', { name: /Open sample/ })).toBeNull();
  });
});
