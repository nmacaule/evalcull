// Types for scripts/bench-inline.mjs, so tests/bench-parity.test.ts type-checks.

export interface InlineIndex {
  starts: Float64Array;
  ends: Float64Array;
  eols: Uint8Array;
  hasBom: boolean;
  lineCount: number;
}

export function indexBlob(
  blob: Blob,
  onProgress?: (p: { bytes: number; total: number }) => void
): Promise<InlineIndex>;

export function secondPassInline(
  blob: Blob,
  result: InlineIndex
): Promise<{ unparseable: number[]; groups: Uint32Array; groupCount: number; candidates: Uint16Array }>;
