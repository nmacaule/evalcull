#!/usr/bin/env node
/**
 * Create golden JSONL fixtures with explicit bytes.
 * This ensures line endings are exactly as specified, not editor-dependent.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'tests', 'fixtures', 'jsonl');
mkdirSync(dir, { recursive: true });

// Helper to write bytes
function writeBytes(name, bytes) {
  writeFileSync(join(dir, name), Buffer.from(bytes));
}

// Helper to write meta
function writeMeta(name, meta) {
  writeFileSync(join(dir, name), JSON.stringify(meta, null, 2) + '\n');
}

// LF terminated lines
writeBytes('lf.jsonl', [
  ...Buffer.from('{"id":1}\n'),
  ...Buffer.from('{"id":2}\n'),
  ...Buffer.from('{"id":3}\n'),
]);
writeMeta('lf.meta.json', {
  lineCount: 3,
  hasBom: false,
  eols: [1, 1, 1],
  parseable: [true, true, true],
});

// CRLF terminated lines
writeBytes('crlf.jsonl', [
  ...Buffer.from('{"id":1}\r\n'),
  ...Buffer.from('{"id":2}\r\n'),
  ...Buffer.from('{"id":3}\r\n'),
]);
writeMeta('crlf.meta.json', {
  lineCount: 3,
  hasBom: false,
  eols: [2, 2, 2],
  parseable: [true, true, true],
});

// No trailing newline
writeBytes('no-trailing-newline.jsonl', [
  ...Buffer.from('{"id":1}\n'),
  ...Buffer.from('{"id":2}\n'),
  ...Buffer.from('{"id":3}'),
]);
writeMeta('no-trailing-newline.meta.json', {
  lineCount: 3,
  hasBom: false,
  eols: [1, 1, 0],
  parseable: [true, true, true],
});

// BOM at start
writeBytes('bom.jsonl', [
  0xef, 0xbb, 0xbf, // UTF-8 BOM
  ...Buffer.from('{"id":1}\n'),
  ...Buffer.from('{"id":2}\n'),
]);
writeMeta('bom.meta.json', {
  lineCount: 2,
  hasBom: true,
  eols: [1, 1],
  parseable: [true, true],
});

// Big integer (2^53 + 1)
writeBytes('big-int.jsonl', [
  ...Buffer.from('{"value":9007199254740993}\n'),
  ...Buffer.from('{"value":9007199254740994}\n'),
]);
writeMeta('big-int.meta.json', {
  lineCount: 2,
  hasBom: false,
  eols: [1, 1],
  parseable: [true, true],
});

// Number formats: 1.0, 1e3, -0
writeBytes('number-formats.jsonl', [
  ...Buffer.from('{"a":1.0,"b":1e3,"c":-0}\n'),
  ...Buffer.from('{"x":1.00,"y":1E3,"z":-0.0}\n'),
]);
writeMeta('number-formats.meta.json', {
  lineCount: 2,
  hasBom: false,
  eols: [1, 1],
  parseable: [true, true],
});

// Unicode escapes
writeBytes('unicode-escapes.jsonl', [
  ...Buffer.from('{"text":"\\u00e9"}\n'),
  ...Buffer.from('{"text":"\\u0041"}\n'),
  ...Buffer.from('{"text":"caf\\u00e9"}\n'),
]);
writeMeta('unicode-escapes.meta.json', {
  lineCount: 3,
  hasBom: false,
  eols: [1, 1, 1],
  parseable: [true, true, true],
});

// Duplicate keys
writeBytes('duplicate-keys.jsonl', [
  ...Buffer.from('{"a":1,"a":2}\n'),
  ...Buffer.from('{"b":1,"b":2,"b":3}\n'),
]);
writeMeta('duplicate-keys.meta.json', {
  lineCount: 2,
  hasBom: false,
  eols: [1, 1],
  parseable: [true, true],
});

// Integer-like keys (JavaScript reorders these)
writeBytes('integer-keys.jsonl', [
  ...Buffer.from('{"1":1,"2":2,"a":3}\n'),
  ...Buffer.from('{"z":1,"2":2,"a":3,"1":4}\n'),
]);
writeMeta('integer-keys.meta.json', {
  lineCount: 2,
  hasBom: false,
  eols: [1, 1],
  parseable: [true, true],
});

// Malformed (one valid, one invalid)
writeBytes('malformed.jsonl', [
  ...Buffer.from('{"valid":true}\n'),
  ...Buffer.from('{"invalid":true\n'), // missing closing brace
]);
writeMeta('malformed.meta.json', {
  lineCount: 2,
  hasBom: false,
  eols: [1, 1],
  parseable: [true, false],
});

// Mixed: CRLF, BOM, big-int, number formats, escapes
writeBytes('mixed.jsonl', [
  0xef, 0xbb, 0xbf, // UTF-8 BOM
  ...Buffer.from('{"big":9007199254740993,"num":1.0}\r\n'),
  ...Buffer.from('{"text":"\\u00e9","val":1e3}\r\n'),
  ...Buffer.from('{"z":-0,"dup":1,"dup":2}\r\n'),
]);
writeMeta('mixed.meta.json', {
  lineCount: 3,
  hasBom: true,
  eols: [2, 2, 2],
  parseable: [true, true, true],
});

console.log('Fixtures created in', dir);
