/**
 * Schema detection tests for WP 5.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { detectFormat } from '../src/lib/schema';
import type { RecordFormat } from '../src/types';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures/shapes');

describe('detectFormat', () => {
  // Get all fixture files
  const fixtureFiles = readdirSync(FIXTURES_DIR).filter(
    (f) => f.endsWith('.jsonl') && !f.startsWith('grouping')
  );

  for (const file of fixtureFiles) {
    const name = file.replace('.jsonl', '');
    const formatFile = join(FIXTURES_DIR, `${name}.format.json`);

    it(`detects ${name} shape`, () => {
      // Read and parse fixture
      const content = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
      const records = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      // Read expected format
      const expectedFormat: RecordFormat = JSON.parse(
        readFileSync(formatFile, 'utf-8')
      );

      // Detect format
      const result = detectFormat(records);

      // Check kind matches
      expect(result.format.kind).toBe(expectedFormat.kind);

      // For non-unknown shapes, check specific fields
      if (expectedFormat.kind !== 'unknown') {
        if (expectedFormat.kind === 'flat') {
          expect(result.format).toMatchObject({
            kind: 'flat',
            promptPath: expectedFormat.promptPath,
            responsePath: expectedFormat.responsePath,
          });
        } else if (expectedFormat.kind === 'messages') {
          expect(result.format).toMatchObject({
            kind: 'messages',
            path: expectedFormat.path,
            roleKey: expectedFormat.roleKey,
            contentKey: expectedFormat.contentKey,
          });
          // Check roles are present (may have different order)
          const detected = result.format as Extract<RecordFormat, { kind: 'messages' }>;
          for (const role of expectedFormat.roles.user) {
            expect(detected.roles.user).toContain(role);
          }
          for (const role of expectedFormat.roles.assistant) {
            expect(detected.roles.assistant).toContain(role);
          }
          for (const role of expectedFormat.roles.system) {
            expect(detected.roles.system).toContain(role);
          }
        } else if (expectedFormat.kind === 'preference') {
          expect(result.format).toMatchObject({
            kind: 'preference',
            chosenPath: expectedFormat.chosenPath,
            rejectedPath: expectedFormat.rejectedPath,
          });
          // promptPath may or may not be present
          if (expectedFormat.promptPath) {
            expect((result.format as any).promptPath).toBe(expectedFormat.promptPath);
          }
        } else if (expectedFormat.kind === 'candidates') {
          expect(result.format).toMatchObject({
            kind: 'candidates',
            promptPath: expectedFormat.promptPath,
            candidatesPath: expectedFormat.candidatesPath,
          });
        }
      }

      // Check confidence
      if (expectedFormat.kind === 'unknown') {
        expect(result.confidence).toBe('none');
      } else {
        expect(['exact', 'partial']).toContain(result.confidence);
      }
    });
  }

  it('returns unknown for empty records', () => {
    const result = detectFormat([]);
    expect(result.format.kind).toBe('unknown');
    expect(result.confidence).toBe('none');
  });

  it('applies tie-breaker: preference > messages', () => {
    // Record that matches both preference and messages (contrived)
    const records = [
      { chosen: 'A', rejected: 'B', messages: [{ role: 'user', content: 'Hi' }] },
      { chosen: 'C', rejected: 'D', messages: [{ role: 'user', content: 'Hey' }] },
      { chosen: 'E', rejected: 'F', messages: [{ role: 'user', content: 'Hello' }] },
    ];
    const result = detectFormat(records);
    expect(result.format.kind).toBe('preference');
  });

  it('applies tie-breaker: messages > candidates', () => {
    // Record with messages array and another string array
    const records = [
      { prompt: 'Hi', messages: [{ role: 'user', content: 'Hi' }], options: ['A', 'B'] },
      { prompt: 'Hey', messages: [{ role: 'user', content: 'Hey' }], options: ['C', 'D'] },
      { prompt: 'Hello', messages: [{ role: 'user', content: 'Hello' }], options: ['E', 'F'] },
    ];
    const result = detectFormat(records);
    expect(result.format.kind).toBe('messages');
  });

  it('applies 80% threshold', () => {
    // 2 out of 3 records have flat shape (66.7% < 80%)
    const records = [
      { prompt: 'A', response: 'B' },
      { prompt: 'C', response: 'D' },
      { foo: 'bar', baz: 123 },
    ];
    const result = detectFormat(records);
    expect(result.format.kind).toBe('unknown');
  });

  it('detects with 80% threshold met', () => {
    // 4 out of 5 records have flat shape (80% == threshold)
    const records = [
      { prompt: 'A', response: 'B' },
      { prompt: 'C', response: 'D' },
      { prompt: 'E', response: 'F' },
      { prompt: 'G', response: 'H' },
      { foo: 'bar', baz: 123 },
    ];
    const result = detectFormat(records);
    expect(result.format.kind).toBe('flat');
    expect(result.confidence).toBe('partial');
  });
});
