import { describe, expect, test } from 'vitest';
import {
  parsePath,
  normalisePath,
  getByPath,
  setByPath,
  stringifyPath,
  type PathSegment,
} from '../src/lib/path';

describe('parsePath', () => {
  describe('valid paths', () => {
    test('simple member', () => {
      expect(parsePath('messages')).toEqual([{ type: 'member', key: 'messages' }]);
    });

    test('member with index', () => {
      expect(parsePath('messages[0]')).toEqual([
        { type: 'member', key: 'messages' },
        { type: 'index', index: 0 },
      ]);
    });

    test('chained members with index', () => {
      expect(parsePath('messages[0].content')).toEqual([
        { type: 'member', key: 'messages' },
        { type: 'index', index: 0 },
        { type: 'member', key: 'content' },
      ]);
    });

    test('negative index', () => {
      expect(parsePath('messages[-1].content')).toEqual([
        { type: 'member', key: 'messages' },
        { type: 'index', index: -1 },
        { type: 'member', key: 'content' },
      ]);
    });

    test('bracketed string key', () => {
      expect(parsePath('["foo bar"]')).toEqual([{ type: 'member', key: 'foo bar' }]);
    });

    test('index then bracketed key', () => {
      expect(parsePath('[0]["key"]')).toEqual([
        { type: 'index', index: 0 },
        { type: 'member', key: 'key' },
      ]);
    });

    test('nested path', () => {
      expect(parsePath('data.items[2].value')).toEqual([
        { type: 'member', key: 'data' },
        { type: 'member', key: 'items' },
        { type: 'index', index: 2 },
        { type: 'member', key: 'value' },
      ]);
    });

    test('multiple indices', () => {
      expect(parsePath('matrix[0][1]')).toEqual([
        { type: 'member', key: 'matrix' },
        { type: 'index', index: 0 },
        { type: 'index', index: 1 },
      ]);
    });
  });

  describe('invalid paths', () => {
    test('empty string', () => {
      expect(() => parsePath('')).toThrow('Empty path');
    });

    test('unclosed bracket', () => {
      expect(() => parsePath('[')).toThrow();
    });

    test('unmatched bracket', () => {
      expect(() => parsePath(']')).toThrow();
    });

    test('double dot', () => {
      expect(() => parsePath('a..b')).toThrow();
    });

    test('bare minus in bracket', () => {
      expect(() => parsePath('[-]')).toThrow();
    });

    test('non-numeric in bracket', () => {
      expect(() => parsePath('[abc]')).toThrow();
    });

    test('trailing dot', () => {
      expect(() => parsePath('a.')).toThrow();
    });

    test('leading dot', () => {
      expect(() => parsePath('.a')).toThrow();
    });
  });
});

describe('normalisePath', () => {
  test('normalises negative index', () => {
    const segments: PathSegment[] = [
      { type: 'member', key: 'messages' },
      { type: 'index', index: -1 },
    ];
    const result = normalisePath(segments, () => 5);
    expect(result).toEqual([
      { type: 'member', key: 'messages' },
      { type: 'index', index: 4 },
    ]);
  });

  test('normalises multiple negative indices', () => {
    const segments: PathSegment[] = [
      { type: 'member', key: 'data' },
      { type: 'index', index: -2 },
      { type: 'index', index: -1 },
    ];
    let callCount = 0;
    const result = normalisePath(segments, () => {
      callCount++;
      return callCount === 1 ? 10 : 3;
    });
    expect(result).toEqual([
      { type: 'member', key: 'data' },
      { type: 'index', index: 8 },
      { type: 'index', index: 2 },
    ]);
  });

  test('leaves non-negative indices unchanged', () => {
    const segments: PathSegment[] = [
      { type: 'member', key: 'arr' },
      { type: 'index', index: 0 },
    ];
    const result = normalisePath(segments, () => 5);
    expect(result).toEqual(segments);
  });

  test('throws on out of bounds', () => {
    const segments: PathSegment[] = [
      { type: 'member', key: 'arr' },
      { type: 'index', index: -10 },
    ];
    expect(() => normalisePath(segments, () => 5)).toThrow('out of bounds');
  });
});

describe('getByPath', () => {
  const obj = {
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ],
    metadata: { count: 2 },
  };

  test('gets nested value', () => {
    const segments = parsePath('messages[0].content');
    expect(getByPath(obj, segments)).toBe('Hello');
  });

  test('gets with negative index', () => {
    const segments = parsePath('messages[-1].content');
    expect(getByPath(obj, segments)).toBe('Hi there');
  });

  test('returns undefined for missing path', () => {
    const segments = parsePath('missing.path');
    expect(getByPath(obj, segments)).toBeUndefined();
  });

  test('returns undefined for null intermediate', () => {
    const segments = parsePath('metadata.missing.deep');
    expect(getByPath(obj, segments)).toBeUndefined();
  });
});

describe('setByPath', () => {
  test('sets nested value immutably', () => {
    const obj = { a: { b: 1 } };
    const segments = parsePath('a.b');
    const result = setByPath(obj, segments, 2);
    expect(result).toEqual({ a: { b: 2 } });
    expect(obj.a.b).toBe(1); // Original unchanged
  });

  test('sets array element', () => {
    const obj = { arr: [1, 2, 3] };
    const segments = parsePath('arr[1]');
    const result = setByPath(obj, segments, 99);
    expect(result).toEqual({ arr: [1, 99, 3] });
  });

  test('sets with negative index', () => {
    const obj = { arr: [1, 2, 3] };
    const segments = parsePath('arr[-1]');
    const result = setByPath(obj, segments, 99);
    expect(result).toEqual({ arr: [1, 2, 99] });
  });

  test('creates intermediate objects', () => {
    const segments = parsePath('a.b.c');
    const result = setByPath(undefined, segments, 1);
    expect(result).toEqual({ a: { b: { c: 1 } } });
  });
});

describe('stringifyPath', () => {
  test('simple member', () => {
    const segments: PathSegment[] = [{ type: 'member', key: 'foo' }];
    expect(stringifyPath(segments)).toBe('foo');
  });

  test('chained members', () => {
    const segments: PathSegment[] = [
      { type: 'member', key: 'foo' },
      { type: 'member', key: 'bar' },
    ];
    expect(stringifyPath(segments)).toBe('foo.bar');
  });

  test('member with index', () => {
    const segments: PathSegment[] = [
      { type: 'member', key: 'arr' },
      { type: 'index', index: 0 },
    ];
    expect(stringifyPath(segments)).toBe('arr[0]');
  });

  test('key with spaces uses bracket notation', () => {
    const segments: PathSegment[] = [{ type: 'member', key: 'foo bar' }];
    expect(stringifyPath(segments)).toBe('["foo bar"]');
  });

  test('empty segments', () => {
    expect(stringifyPath([])).toBe('');
  });

  test('negative index preserved', () => {
    const segments: PathSegment[] = [
      { type: 'member', key: 'arr' },
      { type: 'index', index: -1 },
    ];
    expect(stringifyPath(segments)).toBe('arr[-1]');
  });
});

describe('round-trip', () => {
  test('parse → stringify → parse yields same segments', () => {
    const paths = [
      'messages',
      'messages[0]',
      'messages[0].content',
      'data.items[2].value',
      'matrix[0][1]',
      '["foo bar"]',
    ];

    for (const path of paths) {
      const segments = parsePath(path);
      const stringified = stringifyPath(segments);
      const reparsed = parsePath(stringified);
      expect(reparsed).toEqual(segments);
    }
  });
});
