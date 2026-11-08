/**
 * Knockout compare and line refs for WP 6c (PRD v3.3 §2.2, §2.3, §3.3, §3.5).
 *
 * Oracles: hand-written expected compare[] arrays, expected bytes and expected
 * screen text, derived from the knockout rule (candidate 0 meets candidate 1;
 * the preferred one stays; the incumbent is on the right in even rounds and on
 * the left in odd rounds) and the WP 6c plan's decisions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import App from '../src/App';
import { useReviewStore, clearRegroupHandle } from '../src/store/useReviewStore';
import { configureStorage, configureSidecar, parseSessionText } from '../src/store/persistence';
import { exportLines } from '../src/export/exportLines';
import { buildExport } from '../src/export/buildExport';
import type { FileIndex, RecordFormat, RecordSource } from '../src/types';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type JsonlSource = Extract<RecordSource, { kind: 'jsonl' }>;

/** A JSONL source over the given lines, each terminated by LF. */
function makeSource(
  lines: string[],
  groups: number[],
  candidates: number[],
  fingerprint = 'test-fingerprint'
): JsonlSource {
  const starts = new Float64Array(lines.length);
  const ends = new Float64Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos;
    pos += new TextEncoder().encode(lines[i]).length;
    ends[i] = pos;
    pos += 1;
  }
  const index: FileIndex = {
    fingerprint,
    lineCount: lines.length,
    starts,
    ends,
    eols: new Uint8Array(lines.length).fill(1),
    hasBom: false,
    groups: Uint32Array.from(groups),
    groupCount: new Set(groups).size,
    unparseable: new Uint32Array(0),
    candidates: Uint16Array.from(candidates),
  };
  return {
    kind: 'jsonl',
    index,
    readText: async (i: number) => lines[i],
    readRaw: async (i: number) => new Blob([lines[i] + '\n']),
    readRawRange: async (from: number, to: number) => new Blob(lines.slice(from, to + 1).map((l) => l + '\n')),
  };
}

async function blobToString(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

/** Dispatch a key the way tests.md asks: key, code and real modifier flags. */
function press(key: string, code: string, mods: { shiftKey?: boolean; metaKey?: boolean } = {}) {
  fireEvent.keyDown(document.body, {
    key,
    code,
    shiftKey: mods.shiftKey ?? false,
    metaKey: mods.metaKey ?? false,
    ctrlKey: false,
    altKey: false,
  });
}

/**
 * Load a source through the production seam. load() clears the module-level
 * record cache and derives the mode from the format and the grouping.
 */
async function loadSource(source: JsonlSource, format: RecordFormat) {
  await useReviewStore.getState().load(source, {
    sourceName: 'test.jsonl',
    fingerprint: source.index.fingerprint,
    format,
  });
}

function card(container: HTMLElement, ref: string): HTMLElement {
  const el = container.querySelector(`[data-candidate-ref="${ref}"]`);
  if (!el) throw new Error(`No card for ref ${ref}`);
  return el as HTMLElement;
}

const FLAT: RecordFormat = { kind: 'flat', promptPath: 'prompt', responsePath: 'response' };
const CANDIDATES: RecordFormat = {
  kind: 'candidates',
  promptPath: 'prompt',
  candidatesPath: 'candidates',
};

/** Rows sharing a prompt: prompts A, B, A, C, B, A on lines 0–5 (rows-sharing-prompt.json). */
const ROWS_SHARING = [
  '{"prompt":"A","response":"1"}',
  '{"prompt":"B","response":"2"}',
  '{"prompt":"A","response":"3"}',
  '{"prompt":"C","response":"4"}',
  '{"prompt":"B","response":"5"}',
  '{"prompt":"A","response":"6"}',
];
const ROWS_SHARING_GROUPS = [0, 1, 0, 2, 1, 0];

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  configureStorage({ indexedDB: new IDBFactory() });
  configureSidecar(null);

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
// Store: knockout over four candidates
// -----------------------------------------------------------------------------

describe('store knockout (WP 6c)', () => {
  it('judges four candidates in three pairs; undo and redo walk the pairs', () => {
    // Prompt 0 = lines 0–3 (candidates "0".."3"); prompt 1 = lines 4–5
    const lines = Array.from({ length: 6 }, (_, i) => `{"prompt":"P${i < 4 ? 0 : 1}","response":"r${i}"}`);
    const source = makeSource(lines, [0, 0, 0, 0, 1, 1], [1, 1, 1, 1, 1, 1]);
    useReviewStore.setState({ source, format: FLAT, mode: 'compare', cursor: 0 });

    const store = () => useReviewStore.getState();

    store().prefer('left'); // round 1: "0" vs "1", "0" stays
    expect(store().cursor).toBe(0);
    store().prefer('tie'); // round 2: "2" vs "0" (incumbent right), "0" stays
    expect(store().cursor).toBe(0);
    store().prefer('right'); // round 3: "0" vs "3" (incumbent left), "3" wins
    expect(store().cursor).toBe(1);

    const expected = [
      { left: '0', right: '1', preference: 'left' },
      { left: '2', right: '0', preference: 'tie' },
      { left: '0', right: '3', preference: 'right' },
    ];
    expect(store().decisions.get('0')?.compare).toEqual(expected);

    store().undo();
    expect(store().decisions.get('0')?.compare).toEqual(expected.slice(0, 2));
    expect(store().cursor).toBe(0);
    store().undo();
    expect(store().decisions.get('0')?.compare).toEqual(expected.slice(0, 1));
    store().undo();
    expect(store().decisions.get('0')).toBeUndefined();
    expect(store().cursor).toBe(0);

    store().redo();
    store().redo();
    store().redo();
    expect(store().decisions.get('0')?.compare).toEqual(expected);
  });

  it('re-judging a completed two-candidate prompt replaces its pair and auto-advances', () => {
    // Prompt 0 = lines 0, 2; prompt 1 = lines 1, 3
    const lines = ['{"prompt":"A","response":"a0"}', '{"prompt":"B","response":"b0"}', '{"prompt":"A","response":"a1"}', '{"prompt":"B","response":"b1"}'];
    const source = makeSource(lines, [0, 1, 0, 1], [1, 1, 1, 1]);
    useReviewStore.setState({ source, format: FLAT, mode: 'compare', cursor: 0 });

    useReviewStore.getState().prefer('left');
    expect(useReviewStore.getState().cursor).toBe(1);

    useReviewStore.getState().goTo(0);
    useReviewStore.getState().prefer('right');

    const state = useReviewStore.getState();
    expect(state.decisions.get('0')?.compare).toEqual([
      { left: '0', right: '2', preference: 'right' },
    ]);
    expect(state.past[state.past.length - 1]).toEqual({
      type: 'compare',
      ref: '0',
      pair: 0,
      before: { left: '0', right: '2', preference: 'left' },
      after: { left: '0', right: '2', preference: 'right' },
    });
    expect(state.cursor).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// Store: setStrength
// -----------------------------------------------------------------------------

describe('setStrength (WP 6c)', () => {
  it('attaches strength to the pair just judged without moving the cursor; undo restores it', () => {
    const lines = ['{"prompt":"A","response":"a0"}', '{"prompt":"B","response":"b0"}', '{"prompt":"A","response":"a1"}', '{"prompt":"B","response":"b1"}'];
    const source = makeSource(lines, [0, 1, 0, 1], [1, 1, 1, 1]);
    useReviewStore.setState({ source, format: FLAT, mode: 'compare', cursor: 0 });

    useReviewStore.getState().prefer('left'); // auto-advances to prompt 1
    expect(useReviewStore.getState().cursor).toBe(1);

    useReviewStore.getState().setStrength(2);
    expect(useReviewStore.getState().decisions.get('0')?.compare).toEqual([
      { left: '0', right: '2', preference: 'left', strength: 2 },
    ]);
    expect(useReviewStore.getState().cursor).toBe(1);

    useReviewStore.getState().undo();
    expect(useReviewStore.getState().decisions.get('0')?.compare?.[0]?.strength).toBeUndefined();
    expect(useReviewStore.getState().decisions.get('0')?.compare?.[0]?.preference).toBe('left');
  });

  it('is a no-op when no pair has been judged', () => {
    const source = makeSource(['{"prompt":"A","response":"a"}', '{"prompt":"A","response":"b"}'], [0, 0], [1, 1]);
    useReviewStore.setState({ source, format: FLAT, mode: 'compare', cursor: 0 });

    useReviewStore.getState().setStrength(1);
    expect(useReviewStore.getState().decisions.size).toBe(0);
    expect(useReviewStore.getState().past).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Sessions: version 2 migrates, version 3 is current, anything else is refused
// -----------------------------------------------------------------------------

describe('session version 3 (WP 6c)', () => {
  async function seedIndexedDB(factory: IDBFactory, fingerprint: string, text: string) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('evalcull', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sessions');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(text, fingerprint);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  const PREFERENCE: RecordFormat = { kind: 'preference', chosenPath: 'chosen', rejectedPath: 'rejected' };

  it('a version-2 session restores with compare arrays and history pair 0, and exports as version 3', async () => {
    const text = readFileSync(join(import.meta.dirname, 'fixtures/sessions/valid-v2.json'), 'utf-8');
    const factory = new IDBFactory();
    await seedIndexedDB(factory, 'abc123', text);

    // Same setup as the sidecar PUT test in tests/store.test.ts
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    configureStorage({ indexedDB: factory });
    const putTexts: string[] = [];
    configureSidecar({
      token: 'tok',
      transport: {
        get: async () => null,
        put: async (body: string) => {
          putTexts.push(body);
          return { ok: true as const };
        },
      },
    });

    const source = makeSource(
      ['{"chosen":"a","rejected":"b"}', '{"chosen":"c","rejected":"d"}'],
      [0, 1],
      [2, 2],
      'abc123'
    );
    await useReviewStore.getState().load(source, {
      sourceName: 'test.jsonl',
      fingerprint: 'abc123',
      format: PREFERENCE,
    });

    const state = useReviewStore.getState();
    expect(state.session.kind).toBe('restored');
    expect(state.decisions.get('0')?.compare).toEqual([
      { left: '0:0', right: '0:1', preference: 'left' },
    ]);
    expect(state.past[0]).toEqual({
      type: 'compare',
      ref: '0',
      pair: 0,
      after: { left: '0:0', right: '0:1', preference: 'left' },
    });

    // An export right after the restore writes version 3
    const exported = useReviewStore.getState().exportSession();
    expect(exported).toContain('"version": 3');
    const reparsed = parseSessionText(exported);
    expect(reparsed.ok && reparsed.migrated).toBe(false);

    // The next save writes version 3, captured through the sidecar seam.
    // valid-v2.json already has "1:0" kept, so a change needs another status.
    useReviewStore.getState().decide('1:0', 'rejected');
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    // One change after the restore, one save
    expect(putTexts.length).toBe(1);
    expect(putTexts[putTexts.length - 1]).toContain('"version": 3');
  });

  it('a version-4 session is refused', async () => {
    const v3 = readFileSync(join(import.meta.dirname, 'fixtures/sessions/valid-v3.json'), 'utf-8');
    const v4 = v3.replace('"version": 3', '"version": 4');

    expect(parseSessionText(v4)).toEqual({ ok: false, reason: 'Unknown version: 4' });

    const source = makeSource(['{"prompt":"P","candidates":["a","b"]}'], [0], [2], 'abc123');
    useReviewStore.setState({ source, fingerprint: 'abc123', format: CANDIDATES, mode: 'compare' });
    await useReviewStore.getState().importSession(v4, { force: true });
    const session = useReviewStore.getState().session;
    expect(session.kind).toBe('refused');
    if (session.kind === 'refused') expect(session.reason).toBe('unknown-version');
  });
});

// -----------------------------------------------------------------------------
// setFormat copies the regroup result, candidates included
// -----------------------------------------------------------------------------

describe('setFormat recomputes candidates (WP 6c)', () => {
  it('copies groups, groupCount, unparseable and candidates into the index', async () => {
    configureStorage({ indexedDB: undefined });
    const source = makeSource(
      ['{"prompt":"A","candidates":["x","y","z"]}', '{"prompt":"B","candidates":["u","v"]}'],
      [0, 1],
      [1, 1],
      'regroup-fp'
    );
    const stub = {
      groups: new Uint32Array([0, 1]),
      groupCount: 2,
      unparseable: new Uint32Array(0),
      candidates: new Uint16Array([3, 2]),
    };
    await useReviewStore.getState().load(
      source,
      { sourceName: 'test.jsonl', fingerprint: 'regroup-fp', format: FLAT },
      { regroup: async () => stub, dispose: () => {} }
    );

    await useReviewStore.getState().setFormat(CANDIDATES);

    expect(source.index.groups).toBe(stub.groups);
    expect(source.index.groupCount).toBe(2);
    expect(source.index.unparseable).toBe(stub.unparseable);
    expect(source.index.candidates).toBe(stub.candidates);
    expect(useReviewStore.getState().mode).toBe('compare');

    clearRegroupHandle('regroup-fp');
  });
});

// -----------------------------------------------------------------------------
// App: rows sharing a prompt, line refs, and an edit on the right card
// -----------------------------------------------------------------------------

describe('App over rows sharing a prompt (WP 6c)', () => {
  it('shows each candidate from its own line, judges with line refs, and edits the right card in round 2', async () => {
    const source = makeSource(ROWS_SHARING, ROWS_SHARING_GROUPS, [1, 1, 1, 1, 1, 1]);
    await loadSource(source, FLAT);
    expect(useReviewStore.getState().mode).toBe('compare');

    const { container } = render(<App />);

    // Round 1: line 0 (response "1") left, line 2 (response "3") right
    await waitFor(() => {
      expect(card(container, '0').textContent).toContain('1');
      expect(card(container, '2').textContent).toContain('3');
    });
    expect(screen.getByText('Comparison 1 of 2 · 3 responses')).toBeInTheDocument();

    press('ArrowRight', 'ArrowRight');
    expect(useReviewStore.getState().decisions.get('0')?.compare).toEqual([
      { left: '0', right: '2', preference: 'right' },
    ]);

    // Round 2 (even): challenger line 5 ("6") left, incumbent line 2 ("3") right with the badge
    await waitFor(() => {
      expect(card(container, '5').textContent).toContain('6');
    });
    const right = card(container, '2');
    expect(right.textContent).toContain('3');
    expect(within(right).getByText('Winner so far')).toBeInTheDocument();
    expect(within(card(container, '5')).queryByText('Winner so far')).toBeNull();
    expect(screen.getByText('Comparison 2 of 2 · 3 responses')).toBeInTheDocument();

    // Edit the right card: Tab, E, type, Mod+Enter
    press('Tab', 'Tab');
    press('e', 'KeyE');
    const textarea = await screen.findByRole('textbox', { name: 'Edit content' });
    fireEvent.change(textarea, { target: { value: 'edited' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true, shiftKey: false, ctrlKey: false, altKey: false });

    const decisions = useReviewStore.getState().decisions;
    expect(decisions.get('2')?.edits).toEqual({ response: 'edited' });

    // exportLines writes the edit to line 2 and every other line byte for byte
    const out = await blobToString(await exportLines(source, decisions, () => true, { bom: 'keep' }));
    expect(out).toBe(
      '{"prompt":"A","response":"1"}\n' +
        '{"prompt":"B","response":"2"}\n' +
        '{"prompt":"A","response":"edited"}\n' +
        '{"prompt":"C","response":"4"}\n' +
        '{"prompt":"B","response":"5"}\n' +
        '{"prompt":"A","response":"6"}\n'
    );
  });

  it("marks the focused card with aria-current, and Tab moves it to the other card (D-007)", async () => {
    const source = makeSource(ROWS_SHARING, ROWS_SHARING_GROUPS, [1, 1, 1, 1, 1, 1]);
    await loadSource(source, FLAT);
    const { container } = render(<App />);

    await waitFor(() => {
      expect(card(container, '0').textContent).toContain('1');
      expect(card(container, '2').textContent).toContain('3');
    });
    expect(card(container, '0').getAttribute('aria-current')).toBe('true');
    expect(card(container, '2').getAttribute('aria-current')).toBeNull();

    press('Tab', 'Tab');
    expect(card(container, '0').getAttribute('aria-current')).toBeNull();
    expect(card(container, '2').getAttribute('aria-current')).toBe('true');
  });
});

// -----------------------------------------------------------------------------
// App: in-record candidates
// -----------------------------------------------------------------------------

describe('App over in-record candidates (WP 6c)', () => {
  it('shows "Comparison k of 3" with each card showing its own array element and the badge per round', async () => {
    const source = makeSource(['{"prompt":"P","candidates":["w","x","y","z"]}'], [0], [4]);
    await loadSource(source, CANDIDATES);

    const { container } = render(<App />);

    // Round 1: 0:0 ("w") left, 0:1 ("x") right, no badge
    await waitFor(() => {
      expect(card(container, '0:0').textContent).toContain('w');
    });
    expect(card(container, '0:1').textContent).toContain('x');
    expect(screen.getByText('Comparison 1 of 3 · 4 responses')).toBeInTheDocument();
    expect(screen.queryByText('Winner so far')).toBeNull();

    // Left wins: round 2 (even) puts the incumbent 0:0 on the right against 0:2
    press('ArrowLeft', 'ArrowLeft');
    await waitFor(() => expect(screen.getByText('Comparison 2 of 3 · 4 responses')).toBeInTheDocument());
    expect(card(container, '0:2').textContent).toContain('y');
    expect(within(card(container, '0:0')).getByText('Winner so far')).toBeInTheDocument();

    // Left (0:2) wins: round 3 (odd) puts the incumbent 0:2 on the left against 0:3
    press('ArrowLeft', 'ArrowLeft');
    await waitFor(() => expect(screen.getByText('Comparison 3 of 3 · 4 responses')).toBeInTheDocument());
    expect(card(container, '0:3').textContent).toContain('z');
    expect(within(card(container, '0:2')).getByText('Winner so far')).toBeInTheDocument();
    expect(within(card(container, '0:3')).queryByText('Winner so far')).toBeNull();
  });

  it('shows no pair label for a two-candidate prompt', async () => {
    const source = makeSource(['{"prompt":"P","candidates":["w","x"]}'], [0], [2]);
    await loadSource(source, CANDIDATES);

    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0:1').textContent).toContain('x'));
    expect(screen.queryByText(/^Comparison \d+ of \d+/)).toBeNull();
  });

  it('candidates.jsonl contents: the first prompt shows "Comparison 1 of 2"', async () => {
    // Hand-built from tests/fixtures/shapes/candidates.jsonl: three prompts with 3, 2 and 4 responses
    const lines = readFileSync(join(import.meta.dirname, 'fixtures/shapes/candidates.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    const format = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures/shapes/candidates.format.json'), 'utf-8')
    ) as RecordFormat;
    const source = makeSource(lines, [0, 1, 2], [3, 2, 4]);
    await loadSource(source, format);

    render(<App />);
    expect(await screen.findByText('Comparison 1 of 2 · 3 responses')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// One-candidate prompts and single mode
// -----------------------------------------------------------------------------

describe('one-candidate prompt in compare mode (WP 6c decision e)', () => {
  it('A marks it reviewed; next-unreviewed skips it', async () => {
    // Prompt 0 = line 0 alone (N = 1); prompt 1 = lines 1, 2 (N = 2)
    const lines = ['{"prompt":"A","response":"a"}', '{"prompt":"B","response":"b0"}', '{"prompt":"B","response":"b1"}'];
    const source = makeSource(lines, [0, 1, 1], [1, 1, 1]);
    await loadSource(source, FLAT);
    expect(useReviewStore.getState().mode).toBe('compare');

    render(<App />);
    await screen.findByText('Only one candidate for this prompt');

    press('a', 'KeyA');
    expect(useReviewStore.getState().decisions.get('0')?.status).toBe('kept');
    expect(useReviewStore.getState().counts().reviewed).toBe(1);
    expect(useReviewStore.getState().counts().unreviewed).toBe(1);

    useReviewStore.getState().goTo(1);
    useReviewStore.getState().nextUnreviewed();
    expect(useReviewStore.getState().cursor).toBe(1); // does not stop on prompt 0

    useReviewStore.getState().prefer('left');
    expect(useReviewStore.getState().counts().reviewed).toBe(2);
    useReviewStore.getState().nextUnreviewed();
    expect(useReviewStore.getState().cursor).toBe(1);
  });
});

describe('single mode acts on line refs (WP 6c decision o)', () => {
  it('A stores the status under "i", next-unreviewed skips the line, kept.jsonl holds its bytes', async () => {
    const lines = ['{"prompt":"A","response":"a"}', '{"prompt":"B","response":"b"}', '{"prompt":"C","response":"c"}'];
    const source = makeSource(lines, [0, 1, 2], [1, 1, 1]);
    await loadSource(source, FLAT);
    expect(useReviewStore.getState().mode).toBe('single');

    const { container } = render(<App />);
    await waitFor(() => expect(card(container, '0').textContent).toContain('a'));

    press('a', 'KeyA');
    const decisions = useReviewStore.getState().decisions;
    expect(decisions.get('0')?.status).toBe('kept');
    expect(decisions.has('0:0')).toBe(false);
    expect(useReviewStore.getState().cursor).toBe(1);

    useReviewStore.getState().goTo(2);
    useReviewStore.getState().nextUnreviewed();
    expect(useReviewStore.getState().cursor).toBe(1); // wraps past reviewed line 0

    const result = await buildExport('kept.jsonl', {
      source,
      decisions: useReviewStore.getState().decisions,
      format: FLAT,
      record: (i) => useReviewStore.getState().record(i),
    });
    expect(await blobToString(result.blob)).toBe('{"prompt":"A","response":"a"}\n');
  });
});
