import { describe } from 'vitest';

/**
 * Byte-exact round-trip tests for JSONL fixtures.
 *
 * These tests are written now but cannot pass until later work packages
 * provide the indexer worker (WP 2) and exporter (WP 4).
 */

describe.skip('index triples (WP 2: indexer worker)', () => {
  // For each fixture: index's (start, end, eol) triples equal Buffer.indexOf(0x0A) reference.
  // Line count, bytes and terminators must match exactly.
  // Every line except the deliberately malformed one parses.
});

describe.skip('SHA-256 round-trip (WP 4: exporter)', () => {
  // Ingest → export with no decisions → SHA-256 identical.
  // A concatenation identity alone passes for any partition of the bytes;
  // the per-line oracle above catches off-by-one errors.
});

describe.skip('edited line isolation (WP 4: exporter)', () => {
  // Edit one candidate ⇒ only that line differs.
  // Edit a line containing 9007199254740993, 1.0, 1e3 and -0 ⇒ those tokens are byte-identical in the output.
  // This tests that lossless-json preserves number formatting on edited lines.
});

describe.skip('BOM options (WP 4: exporter)', () => {
  // BOM fixture: keep ⇒ identical; strip ⇒ identical minus EF BB BF; add on a BOM-less fixture ⇒ EF BB BF + identical.
});
