/**
 * Inlined copies of the indexer's two passes, for timing in bench-indexer.mjs.
 *
 * They mirror src/lib/indexer.ts and the per-line work of src/lib/secondPass.ts.
 * tests/bench-parity.test.ts runs them beside the real ones and fails when they
 * drift, so the benchmark never measures stale code.
 */

// -----------------------------------------------------------------------------
// First pass (mirrors src/lib/indexer.ts)
// -----------------------------------------------------------------------------

class GrowableFloat64Array {
  constructor(initialCapacity = 1024) {
    this.buffer = new Float64Array(initialCapacity);
    this._length = 0;
  }
  get length() { return this._length; }
  push(value) {
    if (this._length === this.buffer.length) {
      const newBuffer = new Float64Array(this.buffer.length * 2);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    this.buffer[this._length++] = value;
  }
  trim() {
    return this._length === this.buffer.length
      ? this.buffer
      : this.buffer.subarray(0, this._length);
  }
}

class GrowableUint8Array {
  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this._length = 0;
  }
  get length() { return this._length; }
  push(value) {
    if (this._length === this.buffer.length) {
      const newBuffer = new Uint8Array(this.buffer.length * 2);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    this.buffer[this._length++] = value;
  }
  trim() {
    return this._length === this.buffer.length
      ? this.buffer
      : this.buffer.subarray(0, this._length);
  }
}

export async function indexBlob(blob, onProgress) {
  const starts = new GrowableFloat64Array();
  const ends = new GrowableFloat64Array();
  const eols = new GrowableUint8Array();

  // Detect BOM from the first 3 bytes before scanning
  let hasBom = false;
  if (blob.size >= 3) {
    const first3 = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    hasBom = first3[0] === 0xef && first3[1] === 0xbb && first3[2] === 0xbf;
  }

  let pos = 0;
  let lineStart = 0;
  let prevCR = false;

  const reader = blob.stream().getReader();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    for (let i = 0; i < value.length; i++) {
      const b = value[i];
      if (b === 0x0a) {
        const abs = pos + i;
        starts.push(lineStart);
        ends.push(prevCR ? abs - 1 : abs);
        eols.push(prevCR ? 2 : 1);
        lineStart = abs + 1;
      }
      prevCR = b === 0x0d;
    }

    pos += value.length;

    if (onProgress) {
      onProgress({ bytes: pos, total: blob.size });
    }
  }

  // Last line without trailing newline
  if (lineStart < pos) {
    starts.push(lineStart);
    ends.push(pos);
    eols.push(0);
  }

  return {
    starts: starts.trim(),
    ends: ends.trim(),
    eols: eols.trim(),
    hasBom,
    lineCount: starts.length,
  };
}

// -----------------------------------------------------------------------------
// Second pass: decode + parse + group (mirrors src/lib/secondPass.ts per line)
// -----------------------------------------------------------------------------

function fnv1a32(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

class GroupIdMap {
  constructor() {
    this.map = new Map();
    this.nextId = 0;
  }
  getOrCreate(hi, lo) {
    let inner = this.map.get(hi);
    if (!inner) {
      inner = new Map();
      this.map.set(hi, inner);
    }
    let id = inner.get(lo);
    if (id === undefined) {
      id = this.nextId++;
      inner.set(lo, id);
    }
    return id;
  }
  get count() {
    return this.nextId;
  }
}

/**
 * The bench's second pass over the first pass's result. Generated data is
 * { id, text }; the grouping key is String(parsed.id), as a flat format with
 * promptPath "id" would give, and every parsed line counts one candidate.
 */
export async function secondPassInline(blob, result) {
  // ignoreBOM: true so decoder does NOT auto-strip; BOM skipped via byte offset for line 0
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const unparseable = [];
  const groups = new Uint32Array(result.lineCount);
  const candidates = new Uint16Array(result.lineCount); // WP 6c: 0 until a line parses
  const groupIdMap = new GroupIdMap();

  // Stream the blob in chunks, same pattern as first pass
  const reader2 = blob.stream().getReader();
  let buffer = new Uint8Array(0);
  let bufferStart = 0;
  let lineIdx = 0;

  for (;;) {
    const { value, done } = await reader2.read();

    if (value) {
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;
    }

    while (lineIdx < result.lineCount) {
      const lineStart = result.starts[lineIdx];
      const lineEnd = result.ends[lineIdx];
      const localStart = lineStart - bufferStart;
      const localEnd = lineEnd - bufferStart;

      if (localEnd > buffer.length) break;

      let lineBytes;
      if (lineIdx === 0 && result.hasBom && localStart === 0) {
        lineBytes = buffer.subarray(Math.max(localStart, 3), localEnd);
      } else {
        lineBytes = buffer.subarray(localStart, localEnd);
      }

      const text = decoder.decode(lineBytes);
      let parsed;
      let parseOk = false;

      try {
        parsed = JSON.parse(text);
        parseOk = true;
      } catch {
        unparseable.push(lineIdx);
      }

      // Candidates per line (mirrors secondPass for a row format: 1 when parsed)
      if (parseOk) candidates[lineIdx] = 1;

      // Assign group ID (mirrors secondPass per-line cost)
      if (!parseOk) {
        groups[lineIdx] = groupIdMap.getOrCreate(lineIdx, 0);
      } else {
        const key = String(parsed.id);
        const hi = djb2(key);
        const lo = fnv1a32(key);
        groups[lineIdx] = groupIdMap.getOrCreate(hi, lo);
      }

      lineIdx++;
    }

    if (lineIdx > 0 && lineIdx <= result.lineCount) {
      const lastProcessedEnd = lineIdx < result.lineCount ? result.ends[lineIdx - 1] : result.ends[result.lineCount - 1];
      const trimPoint = lastProcessedEnd - bufferStart;
      if (trimPoint > 0 && trimPoint <= buffer.length) {
        buffer = buffer.subarray(trimPoint);
        bufferStart = lastProcessedEnd;
      }
    }

    if (done) break;
  }

  return { unparseable, groups, groupCount: groupIdMap.count, candidates };
}
