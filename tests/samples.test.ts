// @vitest-environment node
/**
 * The three Phase 0 samples (PRD §4 Phase 0: a conversational, a preference and
 * a multi-candidate JSONL; DR-010): each parses, is LF-only and detects as its shape.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { losslessParse } from '../src/lib/lossless';
import { detectFormat } from '../src/lib/schema';

const DIR = join(import.meta.dirname, '..', 'samples');
const NAMES = ['conversation.jsonl', 'preference.jsonl', 'candidates.jsonl'] as const;

function bytes(name: string): Buffer {
  return readFileSync(join(DIR, name));
}

function lines(name: string): string[] {
  const text = bytes(name).toString('utf8');
  expect(text.endsWith('\n')).toBe(true);
  return text.slice(0, -1).split('\n');
}

describe('samples', () => {
  it("each sample's lines all parse", () => {
    for (const name of NAMES) {
      for (const line of lines(name)) expect(() => losslessParse(line)).not.toThrow();
    }
  });

  it('contains no carriage return', () => {
    for (const name of NAMES) expect(bytes(name).includes(0x0d)).toBe(false);
  });

  it("detects each sample's shape", () => {
    const detect = (name: string) => detectFormat(lines(name).map((l) => JSON.parse(l)));
    expect(detect('conversation.jsonl')).toEqual({
      format: {
        kind: 'messages',
        path: 'messages',
        roleKey: 'role',
        contentKey: 'content',
        roles: { user: ['user'], assistant: ['assistant'], system: ['system'] },
      },
      confidence: 'exact',
    });
    expect(detect('preference.jsonl')).toEqual({
      format: { kind: 'preference', promptPath: 'prompt', chosenPath: 'chosen', rejectedPath: 'rejected' },
      confidence: 'exact',
    });
    expect(detect('candidates.jsonl')).toEqual({
      format: { kind: 'candidates', promptPath: 'prompt', candidatesPath: 'responses' },
      confidence: 'exact',
    });
  });

  it('has the stated sizes', () => {
    expect(lines('conversation.jsonl')).toHaveLength(6);
    expect(lines('preference.jsonl')).toHaveLength(6);
    const candidates = lines('candidates.jsonl').map((l) => (JSON.parse(l) as { responses: unknown[] }).responses.length);
    expect(candidates).toEqual([4, 3, 3, 2]);
  });
});
