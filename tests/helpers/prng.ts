/**
 * Seeded PRNG for deterministic tests.
 * Mulberry32 implementation.
 */

/** Mulberry32 seeded PRNG */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed seeds for deterministic test runs */
export const SEEDS = [12345, 67890, 11111, 22222, 33333];

/** Generate a random integer in [min, max] using the PRNG */
export function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Pick a random element from an array */
export function randomElement<T>(rng: () => number, arr: T[]): T {
  return arr[randomInt(rng, 0, arr.length - 1)];
}
