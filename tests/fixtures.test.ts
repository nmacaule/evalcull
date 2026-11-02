import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fixture integrity tests.
 *
 * These fail loudly if something (git, editor, CI) normalises a fixture,
 * instead of silently weakening the byte-exact gate.
 */

const fixturesDir = join(import.meta.dirname, 'fixtures', 'jsonl');

function readFixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

function readMeta(name: string): {
  lineCount: number;
  hasBom: boolean;
  eols: number[];
  parseable: boolean[];
} {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));
}

describe('fixture integrity', () => {
  test('crlf.jsonl contains 0x0D 0x0A at every line end, no bare 0x0A', () => {
    const buf = readFixture('crlf.jsonl');
    const meta = readMeta('crlf.meta.json');

    // Count line endings
    let lineEnds = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) {
        // Every 0x0A must be preceded by 0x0D
        expect(i).toBeGreaterThan(0);
        expect(buf[i - 1]).toBe(0x0d);
        lineEnds++;
      }
    }
    expect(lineEnds).toBe(meta.lineCount);
  });

  test('lf.jsonl contains 0x0A and no 0x0D anywhere', () => {
    const buf = readFixture('lf.jsonl');
    const meta = readMeta('lf.meta.json');

    // No 0x0D anywhere
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).not.toBe(0x0d);
    }

    // Count LF
    let lfCount = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) lfCount++;
    }
    expect(lfCount).toBe(meta.lineCount);
  });

  test('no-trailing-newline.jsonl does not end with 0x0A', () => {
    const buf = readFixture('no-trailing-newline.jsonl');
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[buf.length - 1]).not.toBe(0x0a);
  });

  test('bom.jsonl starts with EF BB BF', () => {
    const buf = readFixture('bom.jsonl');
    expect(buf.length).toBeGreaterThanOrEqual(3);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  test('non-BOM fixtures do not start with EF BB BF', () => {
    const files = readdirSync(fixturesDir).filter(
      (f) => f.endsWith('.jsonl') && f !== 'bom.jsonl' && f !== 'mixed.jsonl'
    );

    for (const file of files) {
      const buf = readFixture(file);
      const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      expect(hasBom, `${file} should not have BOM`).toBe(false);
    }
  });

  test('big-int.jsonl contains literal 9007199254740993', () => {
    const content = readFixture('big-int.jsonl').toString('utf-8');
    expect(content).toContain('9007199254740993');
  });

  test('number-formats.jsonl contains literals 1.0, 1e3, -0', () => {
    const content = readFixture('number-formats.jsonl').toString('utf-8');
    expect(content).toContain('1.0');
    expect(content).toContain('1e3');
    expect(content).toContain('-0');
  });

  test('each fixture line count matches .meta.json', () => {
    const jsonlFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const metaFile = file.replace('.jsonl', '.meta.json');
      const buf = readFixture(file);
      const meta = readMeta(metaFile);

      // Count lines by counting 0x0A, plus one if file doesn't end with 0x0A
      let lineCount = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) lineCount++;
      }
      // If file doesn't end with newline and has content, add one more line
      if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) {
        lineCount++;
      }

      expect(lineCount, `${file} line count`).toBe(meta.lineCount);
    }
  });

  test('each fixture eol array matches actual line endings', () => {
    const jsonlFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const metaFile = file.replace('.jsonl', '.meta.json');
      const buf = readFixture(file);
      const meta = readMeta(metaFile);

      const actualEols: number[] = [];
      let lineStart = 0;
      // Skip BOM if present
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        lineStart = 3;
      }

      for (let i = lineStart; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
          // Check if preceded by CR
          if (i > 0 && buf[i - 1] === 0x0d) {
            actualEols.push(2); // CRLF
          } else {
            actualEols.push(1); // LF
          }
        }
      }

      // If file doesn't end with newline and has content after lineStart
      if (buf.length > lineStart && buf[buf.length - 1] !== 0x0a) {
        actualEols.push(0); // no newline
      }

      expect(actualEols, `${file} eols`).toEqual(meta.eols);
    }
  });
});
