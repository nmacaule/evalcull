/**
 * WP 6b: opening a file by drop or the Open file button, through the shared
 * loadJsonlFile (D-004); a drop with a file open asks first (owner Q1).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
});
