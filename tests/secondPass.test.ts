// @vitest-environment node
/**
 * Second pass tests for WP 5.
 * Tests both unparseable detection and grouping.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { secondPass } from '../src/lib/secondPass';
import { indexBlob } from '../src/lib/indexer';
import type { RecordFormat } from '../src/types';

/**
 * Create a Blob from bytes. Uses native Blob in node environment.
 */
function createBlob(data: ArrayLike<number>): Blob {
  const bytes = Uint8Array.from(data);
  return new Blob([bytes]);
}

function textToBlob(text: string): Blob {
  return createBlob(new TextEncoder().encode(text));
}

const SHAPES_DIR = join(import.meta.dirname, 'fixtures/shapes');

describe('secondPass grouping', () => {
  it('groups by prompt value for flat format', async () => {
    const buffer = readFileSync(join(SHAPES_DIR, 'grouping.jsonl'));
    const blob = createBlob(buffer);

    const indexResult = await indexBlob(blob);

    const format: RecordFormat = {
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    };

    const result = await secondPass(
      blob,
      indexResult.starts,
      indexResult.ends,
      indexResult.hasBom,
      format
    );

    // Expected: A=0, B=1, A=0, C=2, B=1, A=0
    const expectedGroups = [0, 1, 0, 2, 1, 0];
    expect(Array.from(result.groups)).toEqual(expectedGroups);
    expect(result.groupCount).toBe(3);
    expect(Array.from(result.unparseable)).toEqual([]);
  });

  it('assigns singleton groups for unknown format', async () => {
    const buffer = readFileSync(join(SHAPES_DIR, 'grouping.jsonl'));
    const blob = createBlob(buffer);

    const indexResult = await indexBlob(blob);

    const format: RecordFormat = { kind: 'unknown' };

    const result = await secondPass(
      blob,
      indexResult.starts,
      indexResult.ends,
      indexResult.hasBom,
      format
    );

    // Each line should be its own group
    expect(result.groupCount).toBe(6);
    // Groups should all be different
    const uniqueGroups = new Set(result.groups);
    expect(uniqueGroups.size).toBe(6);
  });

  it('assigns singleton groups for preference without promptPath', async () => {
    const buffer = readFileSync(join(SHAPES_DIR, 'preference-implicit.jsonl'));
    const blob = createBlob(buffer);

    const indexResult = await indexBlob(blob);

    const format: RecordFormat = {
      kind: 'preference',
      chosenPath: 'chosen',
      rejectedPath: 'rejected',
    };

    const result = await secondPass(
      blob,
      indexResult.starts,
      indexResult.ends,
      indexResult.hasBom,
      format
    );

    // Each line should be its own group (no grouping for implicit prompt)
    expect(result.groupCount).toBe(3);
    const uniqueGroups = new Set(result.groups);
    expect(uniqueGroups.size).toBe(3);
  });

  it('groups by promptPath for preference with prompt', async () => {
    // Create a fixture with shared prompts
    const lines = [
      '{"prompt": "X", "chosen": "A", "rejected": "B"}',
      '{"prompt": "Y", "chosen": "C", "rejected": "D"}',
      '{"prompt": "X", "chosen": "E", "rejected": "F"}',
    ];
    const content = lines.join('\n') + '\n';
    const blob = textToBlob(content);

    const indexResult = await indexBlob(blob);

    const format: RecordFormat = {
      kind: 'preference',
      promptPath: 'prompt',
      chosenPath: 'chosen',
      rejectedPath: 'rejected',
    };

    const result = await secondPass(
      blob,
      indexResult.starts,
      indexResult.ends,
      indexResult.hasBom,
      format
    );

    // X=0, Y=1, X=0
    expect(Array.from(result.groups)).toEqual([0, 1, 0]);
    expect(result.groupCount).toBe(2);
  });

  it('groups messages by turns before last assistant', async () => {
    // Two records with same prompt turns, different assistant responses
    const lines = [
      '{"messages": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello"}]}',
      '{"messages": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hey"}]}',
      '{"messages": [{"role": "user", "content": "Bye"}, {"role": "assistant", "content": "Goodbye"}]}',
    ];
    const content = lines.join('\n') + '\n';
    const blob = textToBlob(content);

    const indexResult = await indexBlob(blob);

    const format: RecordFormat = {
      kind: 'messages',
      path: 'messages',
      roleKey: 'role',
      contentKey: 'content',
      roles: {
        user: ['user'],
        assistant: ['assistant'],
        system: [],
      },
    };

    const result = await secondPass(
      blob,
      indexResult.starts,
      indexResult.ends,
      indexResult.hasBom,
      format
    );

    // First two share prompt "Hi", third has "Bye"
    expect(result.groups[0]).toBe(result.groups[1]); // Same group
    expect(result.groups[0]).not.toBe(result.groups[2]); // Different group
    expect(result.groupCount).toBe(2);
  });

  it('handles unparseable lines as singleton groups', async () => {
    const lines = [
      '{"prompt": "A", "response": "1"}',
      'not valid json',
      '{"prompt": "A", "response": "2"}',
    ];
    const content = lines.join('\n') + '\n';
    const blob = textToBlob(content);

    const indexResult = await indexBlob(blob);

    const format: RecordFormat = {
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    };

    const result = await secondPass(
      blob,
      indexResult.starts,
      indexResult.ends,
      indexResult.hasBom,
      format
    );

    // Line 0 and 2 share prompt "A", line 1 is unparseable (own group)
    expect(result.groups[0]).toBe(result.groups[2]); // Same group
    expect(result.groups[1]).not.toBe(result.groups[0]); // Different group (unparseable)
    expect(Array.from(result.unparseable)).toEqual([1]);
    expect(result.groupCount).toBe(2);
  });

  it('handles empty file', async () => {
    const blob = textToBlob('');

    const result = await secondPass(
      blob,
      new Float64Array(0),
      new Float64Array(0),
      false,
      { kind: 'flat', promptPath: 'prompt', responsePath: 'response' }
    );

    expect(result.groupCount).toBe(0);
    expect(result.groups.length).toBe(0);
    expect(result.unparseable.length).toBe(0);
  });
});
