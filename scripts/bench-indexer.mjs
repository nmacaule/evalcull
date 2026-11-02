#!/usr/bin/env node
/**
 * Benchmark the indexer on a 100 MB JSONL file.
 *
 * Generates a temporary file, runs the indexer, prints elapsed time, deletes the file.
 * Not part of CI — timing there is unreliable.
 *
 * This script contains an inlined copy of the scan loop from src/lib/indexer.ts
 * for timing purposes only. If the indexer logic changes, this must be updated
 * to match, or the benchmark will measure stale code.
 *
 * Usage: node scripts/bench-indexer.mjs
 */

import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Blob } from 'node:buffer';

// -----------------------------------------------------------------------------
// Inlined indexer logic (mirrors src/lib/indexer.ts — for timing only)
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

async function indexBlob(blob, onProgress) {
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
// Benchmark
// -----------------------------------------------------------------------------

const TARGET_SIZE = 100 * 1024 * 1024; // 100 MB
const LINE = '{"id":12345,"text":"This is a sample line for benchmarking the JSONL indexer performance."}\n';
const LINE_BYTES = Buffer.from(LINE);

const tempFile = join(tmpdir(), `bench-indexer-${Date.now()}.jsonl`);

console.log('Generating 100 MB JSONL file...');
const startGen = performance.now();

// Write in chunks to avoid memory issues
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
let written = 0;
const fd = openSync(tempFile, 'w');

while (written < TARGET_SIZE) {
  const chunkLines = Math.ceil(CHUNK_SIZE / LINE_BYTES.length);
  const chunk = LINE.repeat(chunkLines);
  writeSync(fd, chunk);
  written += chunkLines * LINE_BYTES.length;
}
closeSync(fd);

const genTime = performance.now() - startGen;
console.log(`Generated in ${genTime.toFixed(0)} ms`);

// Read file into a Blob
console.log('Reading file into Blob...');
const fileBytes = readFileSync(tempFile);
const blob = new Blob([fileBytes]);
console.log(`File size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

// Run indexer
console.log('Running indexer...');
const startIndex = performance.now();
const result = await indexBlob(blob);
const indexTime = performance.now() - startIndex;

console.log(`\nResults:`);
console.log(`  Lines: ${result.lineCount.toLocaleString()}`);
console.log(`  Has BOM: ${result.hasBom}`);
console.log(`  Index time: ${indexTime.toFixed(0)} ms`);

// Cleanup
unlinkSync(tempFile);
console.log('\nTemp file deleted.');

// Summary for STATUS.md
console.log(`\n--- For STATUS.md ---`);
console.log(`100 MB / ${result.lineCount.toLocaleString()} lines indexed in ${indexTime.toFixed(0)} ms`);
