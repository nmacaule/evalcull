// @vitest-environment node
/**
 * Metadata panel fields (PRD §2.8): every field not mapped to the cards.
 */

import { describe, it, expect } from 'vitest';
import { unmappedFields } from '../src/lib/metadata';
import { losslessParse } from '../src/lib/lossless';
import { displayValue } from '../src/lib/display';
import type { RecordFormat } from '../src/types';

const record = losslessParse(
  '{"id":7,"instruction":"a","output":"b","model":"m1","latency":9007199254740993}'
);

describe('unmappedFields', () => {
  it('lists the fields a flat format does not map, digits as written, badging only the unsafe integer', () => {
    const flat: RecordFormat = { kind: 'flat', promptPath: 'instruction', responsePath: 'output' };
    expect(unmappedFields(record, flat)).toEqual([
      { key: 'id', text: '7', unsafeInteger: false },
      { key: 'model', text: 'm1', unsafeInteger: false },
      { key: 'latency', text: '9007199254740993', unsafeInteger: true },
    ]);
  });

  it('leaves out only the messages path for a conversation, by its first segment', () => {
    const data = losslessParse('{"messages":[],"source":"s","data":{"messages":[]}}');
    const messages: RecordFormat = {
      kind: 'messages',
      path: 'messages',
      roleKey: 'role',
      contentKey: 'content',
      roles: { user: [], assistant: [], system: [] },
    };
    expect(unmappedFields(data, messages).map((f) => f.key)).toEqual(['source', 'data']);
    expect(unmappedFields(data, { ...messages, path: 'data.messages' }).map((f) => f.key)).toEqual([
      'messages',
      'source',
    ]);
  });

  it('lists every field for an unknown format', () => {
    expect(unmappedFields(record, { kind: 'unknown' }).map((f) => f.key)).toEqual([
      'id',
      'instruction',
      'output',
      'model',
      'latency',
    ]);
  });
});

describe('displayValue', () => {
  it('shows a null field as null, as written in the file; only a missing value is empty (D-030)', () => {
    expect(displayValue(null)).toBe('null');
    expect(displayValue(undefined)).toBe('');
    const data = losslessParse('{"id":null,"instruction":"a","output":"b"}');
    const flat: RecordFormat = { kind: 'flat', promptPath: 'instruction', responsePath: 'output' };
    expect(unmappedFields(data, flat)).toEqual([{ key: 'id', text: 'null', unsafeInteger: false }]);
  });

  it('badges a number outside the safe range written with a fraction or an exponent (D-051)', () => {
    const data = losslessParse('{"a":9007199254740993.0,"b":1e20,"c":1e400,"d":1.5,"e":1e3,"f":-1e20}');
    expect(unmappedFields(data, { kind: 'unknown' }).map((f) => [f.key, f.unsafeInteger])).toEqual([
      ['a', true],
      ['b', true],
      ['c', true],
      ['d', false],
      ['e', false],
      ['f', true],
    ]);
  });

  it('badges a number just above the safe range written with a fraction (D-054)', () => {
    const data = losslessParse('{"a":9007199254740991.4,"b":-9007199254740991.4,"c":9007199254740991.0}');
    expect(unmappedFields(data, { kind: 'unknown' }).map((f) => [f.key, f.unsafeInteger])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ]);
  });
});
