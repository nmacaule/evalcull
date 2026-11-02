/**
 * RFC 9535 subset JSON path parser with negative-index normalisation.
 *
 * Grammar (subset):
 * - Member access: `.foo` or `["foo"]`
 * - Index access: `[0]`, `[-1]` (negative counts from end)
 * - Chained: `messages[0].content`, `messages[-1].content`
 */

export type PathSegment = { type: 'member'; key: string } | { type: 'index'; index: number };

/**
 * Parse a path string into segments. Throws on invalid syntax.
 */
export function parsePath(path: string): PathSegment[] {
  if (path === '') {
    throw new Error('Empty path');
  }

  const segments: PathSegment[] = [];
  let i = 0;

  // Handle leading member (no dot prefix)
  if (path[0] === '.') {
    throw new Error('Path cannot start with a dot');
  }
  if (path[0] !== '[') {
    const end = findMemberEnd(path, 0);
    if (end === 0) {
      throw new Error(`Invalid path at position ${i}`);
    }
    segments.push({ type: 'member', key: path.slice(0, end) });
    i = end;
  }

  while (i < path.length) {
    if (path[i] === '.') {
      i++;
      if (i >= path.length || path[i] === '.' || path[i] === '[') {
        throw new Error(`Invalid path at position ${i}`);
      }
      const end = findMemberEnd(path, i);
      if (end === i) {
        throw new Error(`Invalid path at position ${i}`);
      }
      segments.push({ type: 'member', key: path.slice(i, end) });
      i = end;
    } else if (path[i] === '[') {
      i++;
      if (i >= path.length) {
        throw new Error('Unclosed bracket');
      }

      if (path[i] === '"') {
        // Bracketed string key: ["foo"]
        i++;
        const endQuote = path.indexOf('"', i);
        if (endQuote === -1) {
          throw new Error('Unclosed string in bracket');
        }
        const key = path.slice(i, endQuote);
        i = endQuote + 1;
        if (path[i] !== ']') {
          throw new Error(`Expected ] at position ${i}`);
        }
        i++;
        segments.push({ type: 'member', key });
      } else if (path[i] === '-' || (path[i] >= '0' && path[i] <= '9')) {
        // Numeric index: [0] or [-1]
        const start = i;
        if (path[i] === '-') {
          i++;
          if (i >= path.length || path[i] < '0' || path[i] > '9') {
            throw new Error(`Invalid index at position ${start}`);
          }
        }
        while (i < path.length && path[i] >= '0' && path[i] <= '9') {
          i++;
        }
        if (path[i] !== ']') {
          throw new Error(`Expected ] at position ${i}`);
        }
        const index = parseInt(path.slice(start, i), 10);
        i++;
        segments.push({ type: 'index', index });
      } else {
        throw new Error(`Invalid bracket content at position ${i}`);
      }
    } else {
      throw new Error(`Unexpected character at position ${i}`);
    }
  }

  return segments;
}

function findMemberEnd(path: string, start: number): number {
  let i = start;
  while (i < path.length && path[i] !== '.' && path[i] !== '[') {
    // Reject unmatched ]
    if (path[i] === ']') {
      throw new Error(`Unexpected ] at position ${i}`);
    }
    i++;
  }
  return i;
}

/**
 * Normalise negative indices given an array length getter.
 * The getter receives the segments up to (but not including) the current index segment.
 */
export function normalisePath(
  segments: PathSegment[],
  getLength: (segments: PathSegment[]) => number
): PathSegment[] {
  return segments.map((seg, i) => {
    if (seg.type === 'index' && seg.index < 0) {
      const length = getLength(segments.slice(0, i));
      const normalised = length + seg.index;
      if (normalised < 0) {
        throw new Error(`Index ${seg.index} out of bounds for length ${length}`);
      }
      return { type: 'index', index: normalised };
    }
    return seg;
  });
}

/**
 * Get a value from an object by path segments.
 */
export function getByPath(obj: unknown, segments: PathSegment[]): unknown {
  let current: unknown = obj;

  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (seg.type === 'member') {
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[seg.key];
    } else {
      if (!Array.isArray(current)) {
        return undefined;
      }
      const index = seg.index < 0 ? current.length + seg.index : seg.index;
      current = current[index];
    }
  }

  return current;
}

/**
 * Set a value in an object by path segments (immutable, returns new object).
 */
export function setByPath(obj: unknown, segments: PathSegment[], value: unknown): unknown {
  if (segments.length === 0) {
    return value;
  }

  const [first, ...rest] = segments;

  if (first.type === 'member') {
    const current = (obj as Record<string, unknown>) ?? {};
    return {
      ...current,
      [first.key]: setByPath(current[first.key], rest, value),
    };
  } else {
    const current = (obj as unknown[]) ?? [];
    const index = first.index < 0 ? current.length + first.index : first.index;
    const newArray = [...current];
    newArray[index] = setByPath(current[index], rest, value);
    return newArray;
  }
}

/**
 * Stringify segments back to a normalised path string.
 */
export function stringifyPath(segments: PathSegment[]): string {
  if (segments.length === 0) {
    return '';
  }

  let result = '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'member') {
      // Use dot notation for simple identifiers, bracket notation otherwise
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg.key)) {
        if (i === 0) {
          result += seg.key;
        } else {
          result += '.' + seg.key;
        }
      } else {
        result += '["' + seg.key + '"]';
      }
    } else {
      result += '[' + seg.index + ']';
    }
  }

  return result;
}
