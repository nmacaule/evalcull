/**
 * Line diff for the Diff view (PRD §2.5): Myers' O((N+M)·D) algorithm after
 * trimming the common prefix and suffix. The edit distance searched is capped
 * at MAX_D; past it the remaining old lines are all deleted and the new ones
 * all inserted. The trace holds at most MAX_D + 1 frontier arrays of
 * 2·min(N + M, MAX_D) + 3 entries (about 8 MB at the cap), so memory never
 * grows with N·M.
 */

export type DiffOp = { op: 'equal' | 'delete' | 'insert'; text: string };

export const MAX_D = 1000;

function lines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

export function diffLines(oldText: string, newText: string): DiffOp[] {
  const a = lines(oldText);
  const b = lines(newText);

  // Common prefix and suffix
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: DiffOp[] = a.slice(0, start).map((text) => ({ op: 'equal', text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ op: 'equal', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  return [...head, ...myers(midA, midB), ...tail];
}

function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ op: 'insert', text }));
  if (m === 0) return a.map((text) => ({ op: 'delete', text }));

  const max = Math.min(n + m, MAX_D);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d, offset);
    }
  }

  // Past the cap: every old line deleted, then every new line inserted
  return [
    ...a.map((text): DiffOp => ({ op: 'delete', text })),
    ...b.map((text): DiffOp => ({ op: 'insert', text })),
  ];
}

function backtrack(a: string[], b: string[], trace: Int32Array[], dEnd: number, offset: number): DiffOp[] {
  const out: DiffOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ op: 'equal', text: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) {
      out.push({ op: 'insert', text: b[y - 1] });
      y--;
    } else {
      out.push({ op: 'delete', text: a[x - 1] });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    out.push({ op: 'equal', text: a[x - 1] });
    x--;
    y--;
  }
  return out.reverse();
}
