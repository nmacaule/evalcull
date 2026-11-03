// @vitest-environment node
/**
 * Tests for readLine helper with BOM handling.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readLineText } from '../src/lib/readLine';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures/jsonl');

function createBlob(buffer: Buffer): Blob {
  return new Blob([Uint8Array.from(buffer)]);
}

describe('readLineText', () => {
  it('strips BOM from line 0 when hasBom is true', async () => {
    const buffer = readFileSync(join(FIXTURES_DIR, 'bom.jsonl'));
    const blob = createBlob(buffer);

    // bom.jsonl has BOM at start, line 0 starts at 0
    // The actual content starts at byte 3 (after EF BB BF)
    const text = await readLineText(blob, 0, buffer.indexOf(0x0a), 0, true);

    // Should not start with BOM character
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    // Should be valid JSON
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('includes BOM character when hasBom is false (no byte skip)', async () => {
    const buffer = readFileSync(join(FIXTURES_DIR, 'bom.jsonl'));
    const blob = createBlob(buffer);

    // Read without BOM byte skip - decoder with ignoreBOM: true preserves U+FEFF
    const text = await readLineText(blob, 0, buffer.indexOf(0x0a), 0, false);

    // First character should be U+FEFF (BOM preserved by ignoreBOM: true)
    expect(text.charCodeAt(0)).toBe(0xfeff);
  });

  it('preserves U+FEFF in line after line 0', async () => {
    // Create a file where line 1 starts with EF BB BF (BOM bytes)
    // Line 0: {"a":1}\n
    // Line 1: \xEF\xBB\xBF{"b":2}\n
    const line0 = Buffer.from('{"a":1}\n');
    const bomBytes = Buffer.from([0xef, 0xbb, 0xbf]);
    const line1Content = Buffer.from('{"b":2}\n');
    const combined = Buffer.concat([line0, bomBytes, line1Content]);
    const blob = createBlob(combined);

    // Line 1 starts at byte 8 (after line0), ends before newline
    const line1Start = line0.length;
    const line1End = combined.length - 1; // before final newline

    const text = await readLineText(blob, line1Start, line1End, 1, false);

    // U+FEFF should be preserved (not stripped by decoder)
    expect(text.charCodeAt(0)).toBe(0xfeff);
    // Rest should be the JSON
    expect(text.slice(1)).toBe('{"b":2}');
  });

  it('reads line 1+ normally regardless of hasBom', async () => {
    const buffer = readFileSync(join(FIXTURES_DIR, 'bom.jsonl'));
    const blob = createBlob(buffer);

    // Find second line
    const firstNewline = buffer.indexOf(0x0a);
    const secondLineStart = firstNewline + 1;
    let secondLineEnd = secondLineStart;
    while (secondLineEnd < buffer.length && buffer[secondLineEnd] !== 0x0a) {
      secondLineEnd++;
    }

    const text = await readLineText(blob, secondLineStart, secondLineEnd, 1, true);

    // Should be valid JSON
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('handles non-BOM file line 0', async () => {
    const buffer = readFileSync(join(FIXTURES_DIR, 'lf.jsonl'));
    const blob = createBlob(buffer);

    const firstNewline = buffer.indexOf(0x0a);
    const text = await readLineText(blob, 0, firstNewline, 0, false);

    // Should be valid JSON
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
