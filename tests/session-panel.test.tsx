/**
 * WP 6b: the storage state in the header and the Export panel's Session
 * section (owner Q6, 4 Nov 2026; PRD §2.7, §3.9, §5 Persistence). Storage is
 * reached through configureStorage and the sidecar through configureSidecar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import App from '../src/App';
import { ExportPanel } from '../src/components/ExportPanel';
import { useReviewStore } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar } from '../src/store/persistence';
import { makeSource, loadSource, resetStore, FLAT_IO } from './helpers/app';
import type { RecordFormat } from '../src/types';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures/sessions', `${name}.json`), 'utf-8');

const CANDIDATES: RecordFormat = { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'candidates' };
const twoPrompts = () =>
  makeSource(
    ['{"prompt":"p","candidates":["a","b"]}', '{"prompt":"q","candidates":["c","d"]}'],
    [0, 1],
    [2, 2],
    { fingerprint: 'abc123' }
  );

const status = () => screen.getByRole('status').textContent;

// fake-indexeddb runs on setImmediate, which the fake clock leaves real
async function settle(): Promise<void> {
  for (let i = 0; i < 20 && useReviewStore.getState().storageState.kind === 'saving'; i++) {
    await act(async () => {
      await new Promise<void>((r) => setImmediate(r));
    });
  }
}

let created: Blob[] = [];
let downloads: string[] = [];

beforeEach(() => {
  resetStore();
  created = [];
  downloads = [];
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        created.push(blob);
        return 'blob:test';
      });
      static revokeObjectURL = vi.fn();
    }
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('storage state in the header', () => {
  const lines = ['{"instruction":"q","output":"a"}', '{"instruction":"r","output":"b"}'];

  it('reads No unsaved changes after load, Saving… while a save is pending, then Saved', async () => {
    await loadSource(makeSource(lines, [0, 1], [1, 1]), FLAT_IO);
    render(<App />);
    expect(status()).toBe('No unsaved changes');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => useReviewStore.getState().decide('0', 'kept'));
    expect(status()).toBe('Saving…');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await settle();
    expect(status()).toBe('Saved');
  });

  it('reads Save failed with the reason when the sidecar refuses the PUT', async () => {
    configureSidecar({
      token: 'tok',
      transport: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue({ ok: false, status: 500, message: 'boom' }),
      },
    });
    await loadSource(makeSource(lines, [0, 1], [1, 1]), FLAT_IO);
    render(<App />);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => useReviewStore.getState().decide('0', 'kept'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await settle();
    expect(status()).toBe('Save failed: Sidecar PUT failed: 500 boom');
  });

  it('reads Storage off once a save finds neither sink', async () => {
    configureStorage({ indexedDB: undefined });
    await loadSource(makeSource(lines, [0, 1], [1, 1]), FLAT_IO);
    render(<App />);
    expect(status()).toBe('No unsaved changes');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => useReviewStore.getState().decide('0', 'kept'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await settle();
    expect(status()).toBe('Storage off: IndexedDB not available');
  });
});

describe('a cancelled switch in the header (DR-001 B-i)', () => {
  it('offers Download session and Open anyway, discarding changes; Download session saves the session file', async () => {
    configureStorage({ indexedDB: undefined });
    const lines = ['{"instruction":"q","output":"a"}', '{"instruction":"r","output":"b"}'];
    await loadSource(makeSource(lines, [0, 1], [1, 1], { fingerprint: 'fp-a' }), FLAT_IO);
    render(<App />);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => useReviewStore.getState().decide('0', 'kept'));
    await act(async () => {
      await loadSource(makeSource(lines, [0, 1], [1, 1], { fingerprint: 'fp-b' }), FLAT_IO);
    });

    expect(status()).toBe(
      "The current file's changes could not be saved: IndexedDB not available. Download the session to keep them."
    );
    expect(screen.getByRole('button', { name: 'Open anyway, discarding changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download session' }));
    expect(downloads).toEqual(['test.jsonl.evalcull.json']);
  });
});

describe('Session section', () => {
  it('states the browser-storage limit and downloads the session as version 3', async () => {
    await loadSource(twoPrompts(), CANDIDATES);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    expect(
      screen.getByText(
        'Browser storage is best-effort: Safari deletes it after seven days without a visit. Download the session to keep it.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download session' }));

    expect(downloads).toEqual(['test.jsonl.evalcull.json']);
    expect(await created[0].text()).toContain('"version": 3');
  });

  it('loads a session file', async () => {
    await loadSource(twoPrompts(), CANDIDATES);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('valid-v3')], 'valid-v3.json')] },
    });

    await waitFor(() => expect(useReviewStore.getState().session.kind).toBe('restored'));
  });

  it('shows a fingerprint refusal with Load anyway, which restores it', async () => {
    await loadSource(makeSource(['{"a":1}', '{"a":2}'], [0, 1], [1, 1], { fingerprint: 'abc123' }), {
      kind: 'unknown',
    });
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('fingerprint-mismatch')], 'm.json')] },
    });

    await waitFor(() =>
      expect(
        screen.getByText('Session fingerprint different-fingerprint does not match source abc123')
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load anyway' }));
    await waitFor(() => expect(useReviewStore.getState().session.kind).toBe('restored'));
  });

  it('a fingerprint refusal and its Load anyway render together, in one commit (D-087)', async () => {
    await loadSource(makeSource(['{"a":1}', '{"a":2}'], [0, 1], [1, 1], { fingerprint: 'abc123' }), {
      kind: 'unknown',
    });
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    // Every state the DOM passes through, recorded as it changes
    const states: string[] = [];
    const observer = new MutationObserver(() => {
      const message = screen.queryByText(/does not match source/) !== null;
      const offer = screen.queryByRole('button', { name: 'Load anyway' }) !== null;
      const state = `message ${message}, Load anyway ${offer}`;
      if (states[states.length - 1] !== state) states.push(state);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });

    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('fingerprint-mismatch')], 'm.json')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load anyway' })).toBeInTheDocument());
    observer.disconnect();

    expect(states).toEqual(['message false, Load anyway false', 'message true, Load anyway true']);
  });

  it("Load anyway is not offered on a new file for the previous file's refused session (D-049)", async () => {
    configureSidecar({
      token: 'tok',
      transport: {
        get: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(fixture('fingerprint-mismatch')),
        put: vi.fn().mockResolvedValue({ ok: true }),
      },
    });
    await loadSource(makeSource(['{"a":1}', '{"a":2}'], [0, 1], [1, 1], { fingerprint: 'fp-a' }), { kind: 'unknown' });
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('fingerprint-mismatch')], 'm.json')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load anyway' })).toBeInTheDocument());

    // The new file's own session is refused at load; that refusal came from no file the user picked
    await act(async () => {
      await loadSource(makeSource(['{"a":3}', '{"a":4}'], [0, 1], [1, 1], { fingerprint: 'fp-b' }), { kind: 'unknown' });
    });

    expect({
      fingerprint: useReviewStore.getState().fingerprint,
      session: useReviewStore.getState().session.kind,
      loadAnyway: screen.queryByRole('button', { name: 'Load anyway' }) !== null,
    }).toEqual({ fingerprint: 'fp-b', session: 'refused', loadAnyway: false });
  });

  it('Load anyway reports the refused session file by name when it is cancelled (D-077)', async () => {
    configureStorage({ indexedDB: undefined });
    await loadSource(makeSource(['{"a":1}', '{"a":2}'], [0, 1], [1, 1], { fingerprint: 'abc123' }), { kind: 'unknown' });
    useReviewStore.getState().decide('0', 'kept');
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('fingerprint-mismatch')], 's.json')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load anyway' })).toBeInTheDocument());

    // Neither sink: the forced import cannot save the change first, so it is cancelled
    fireEvent.click(screen.getByRole('button', { name: 'Load anyway' }));

    await waitFor(() => expect(useReviewStore.getState().cancelledSwitch).not.toBeNull());
    expect(useReviewStore.getState().cancelledSwitch).toEqual({ name: 's.json' });
  });

  it('a matching session whose import is cancelled is never offered for Load anyway (D-078)', async () => {
    configureStorage({ indexedDB: undefined });
    await loadSource(twoPrompts(), CANDIDATES);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    // A refusal is showing: s.json does not match the source
    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('fingerprint-mismatch')], 's.json')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load anyway' })).toBeInTheDocument());

    // A change, then y.json, which matches, but neither sink takes the change, so its import is cancelled
    act(() => useReviewStore.getState().decide('0:0', 'kept'));
    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('valid-v3')], 'y.json')] },
    });
    await waitFor(() => expect(useReviewStore.getState().cancelledSwitch).toEqual({ name: 'y.json' }));

    expect(screen.queryByRole('button', { name: 'Load anyway' })).toBeNull();
  });

  it('Load anyway is not offered beside a refusal another operation set on the same file (D-081)', async () => {
    configureSidecar({
      token: 'tok',
      transport: {
        get: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(fixture('unknown-version')),
        put: vi.fn().mockResolvedValue({ ok: true }),
      },
    });
    await loadSource(twoPrompts(), CANDIDATES);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('fingerprint-mismatch')], 'm.json')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load anyway' })).toBeInTheDocument());

    // The same file opened again: same fingerprint, and its own session is refused at load
    await act(async () => {
      await loadSource(twoPrompts(), CANDIDATES);
    });

    expect({
      message: screen.getByRole('alert').textContent,
      loadAnyway: screen.queryByRole('button', { name: 'Load anyway' }) !== null,
    }).toEqual({ message: 'Unknown version: 99', loadAnyway: false });
  });

  it('a session file of the same name whose import is cancelled is never offered for Load anyway (D-088)', async () => {
    configureStorage({ indexedDB: undefined });
    await loadSource(twoPrompts(), CANDIDATES);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);
    // A refusal is showing: this session file does not match the source
    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('fingerprint-mismatch')], 'test.jsonl.evalcull.json')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load anyway' })).toBeInTheDocument());

    // A change, then another session file of the same name, which matches, but
    // neither sink takes the change, so its import is cancelled
    act(() => useReviewStore.getState().decide('0:0', 'kept'));
    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('valid-v3')], 'test.jsonl.evalcull.json')] },
    });
    await waitFor(() =>
      expect(useReviewStore.getState().cancelledSwitch).toEqual({ name: 'test.jsonl.evalcull.json' })
    );

    expect(screen.queryByRole('button', { name: 'Load anyway' })).toBeNull();
  });

  it('shows an unknown-version refusal without Load anyway', async () => {
    await loadSource(twoPrompts(), CANDIDATES);
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText('Session file'), {
      target: { files: [new File([fixture('unknown-version')], 'u.json')] },
    });

    await waitFor(() => expect(useReviewStore.getState().session.kind).toBe('refused'));
    expect(screen.getByRole('alert').textContent).toBe('Unknown version: 99');
    expect(screen.queryByRole('button', { name: 'Load anyway' })).toBeNull();
  });

  it('offers a newer copy saved in this browser and applies it on request', async () => {
    const factory = new IDBFactory();
    configureStorage({ indexedDB: factory });
    const base = JSON.parse(fixture('valid-v3'));
    const sidecar = JSON.stringify({ ...base, savedAt: 1000, decisions: {} });
    const local = JSON.stringify({
      ...base,
      savedAt: 2000,
      decisions: { '0:1': { status: 'kept', updatedAt: 2000 } },
    });
    // Seed through the factory passed to configureStorage
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('evalcull', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sessions');
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(local, 'abc123');
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    configureSidecar({
      token: 'tok',
      transport: { get: vi.fn().mockResolvedValue(sidecar), put: vi.fn().mockResolvedValue({ ok: true }) },
    });
    await loadSource(twoPrompts(), CANDIDATES);
    expect(useReviewStore.getState().newerLocalCopy).not.toBeNull();
    render(<ExportPanel open={true} onOpenChange={() => {}} />);

    expect(screen.getByText(/A newer copy saved in this browser at .* differs from the session file\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the newer copy' }));

    await waitFor(() => expect(useReviewStore.getState().decisions.get('0:1')?.status).toBe('kept'));
  });

  it('keeps the storage state visible while the editor is open', async () => {
    const lines = ['{"instruction":"q","output":"a"}', '{"instruction":"r","output":"b"}'];
    await loadSource(makeSource(lines, [0, 1], [1, 1]), FLAT_IO);
    render(<App />);
    expect(status()).toBe('No unsaved changes');
    // E opens the editor once the record has loaded
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument());
    fireEvent.keyDown(document.body, { key: 'e', code: 'KeyE' });
    expect(screen.getByLabelText('Edit content')).toBeInTheDocument();
    expect(status()).toBe('No unsaved changes');
  });
});
