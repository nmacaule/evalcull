#!/usr/bin/env node
/**
 * Benchmark the indexer on a 100 MB JSONL file.
 *
 * Generates a temporary file, runs the indexer, prints elapsed time, deletes the file.
 * Not part of CI — timing there is unreliable.
 *
 * The two passes it times are inlined copies of the indexer's, in
 * scripts/bench-inline.mjs; tests/bench-parity.test.ts fails when they drift
 * from src/lib/indexer.ts and src/lib/secondPass.ts.
 *
 * Usage: node scripts/bench-indexer.mjs
 */

import {
  openSync,
  writeSync,
  closeSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Blob } from 'node:buffer';
import { indexBlob, secondPassInline } from './bench-inline.mjs';

// -----------------------------------------------------------------------------
// Benchmark
// -----------------------------------------------------------------------------

const TARGET_SIZE = 100 * 1024 * 1024; // 100 MB
const LINE = '{"id":12345,"text":"This is a sample line for benchmarking the JSONL indexer performance."}\n';
const LINE_BYTES = Buffer.from(LINE);

// Scratch files stay inside the repository: node_modules/.tmp is git-ignored.
// It exists only after a tsc -b build, so create it.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempFile = join(repoRoot, 'node_modules', '.tmp', 'bench-indexer.jsonl');
mkdirSync(dirname(tempFile), { recursive: true });

// Remove the 100 MB file however the run ends, a failed run included
process.on('exit', () => {
  if (existsSync(tempFile)) unlinkSync(tempFile);
});

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

// Run indexer (first pass)
console.log('Running first pass (index)...');
const startIndex = performance.now();
const result = await indexBlob(blob);
const indexTime = performance.now() - startIndex;

console.log(`  Lines: ${result.lineCount.toLocaleString()}`);
console.log(`  Has BOM: ${result.hasBom}`);
console.log(`  First pass: ${indexTime.toFixed(0)} ms`);

// Second pass: decode + parse + group
console.log('Running second pass (decode + parse + group)...');
const startSecond = performance.now();
const second = await secondPassInline(blob, result);
const secondPassTime = performance.now() - startSecond;
console.log(`  Second pass: ${secondPassTime.toFixed(0)} ms`);
console.log(`  Unparseable: ${second.unparseable.length}`);
console.log(`  Groups: ${second.groupCount.toLocaleString()}`);

const totalTime = indexTime + secondPassTime;
console.log(`  Total: ${totalTime.toFixed(0)} ms`);

// Cleanup (the exit handler also removes the file if the run fails before here)
unlinkSync(tempFile);
console.log('\nTemp file deleted.');

// Summary for STATUS.md
console.log(`\n--- For STATUS.md ---`);
console.log(`100 MB / ${result.lineCount.toLocaleString()} lines:`);
console.log(`  First pass (index): ${indexTime.toFixed(0)} ms`);
console.log(`  Second pass (decode + parse + group): ${secondPassTime.toFixed(0)} ms (Node figure)`);
console.log(`  Total: ${totalTime.toFixed(0)} ms`);
