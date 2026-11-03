/**
 * Group key extraction and 64-bit hashing for prompt grouping.
 *
 * Uses FNV-1a for lower 32 bits and djb2 for upper 32 bits,
 * providing ~3e-8 collision probability at 1M distinct keys.
 */

import type { RecordFormat } from '../types';
import { parsePath, getByPath } from './path';

/**
 * FNV-1a 32-bit hash.
 */
function fnv1a32(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * djb2 32-bit hash (Bernstein).
 */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * 64-bit hash as two uncorrelated 32-bit halves.
 * lo = FNV-1a, hi = djb2.
 *
 * @returns [hi, lo] tuple
 */
export function hash64(str: string): [number, number] {
  return [djb2(str), fnv1a32(str)];
}

/**
 * Group ID map using two-level Map for 64-bit keys.
 * Outer: hi -> inner, Inner: lo -> groupId.
 */
export class GroupIdMap {
  private map = new Map<number, Map<number, number>>();
  private nextId = 0;

  /**
   * Get or create a group ID for the given 64-bit hash.
   */
  getOrCreate(hi: number, lo: number): number {
    let inner = this.map.get(hi);
    if (!inner) {
      inner = new Map();
      this.map.set(hi, inner);
    }

    let id = inner.get(lo);
    if (id === undefined) {
      id = this.nextId++;
      inner.set(lo, id);
    }
    return id;
  }

  get count(): number {
    return this.nextId;
  }
}

/**
 * Normalise a message for grouping key serialisation.
 * Matches pairs.ts normaliseMessage logic.
 */
function normaliseMessageForKey(
  msg: Record<string, unknown>,
  roleKey: string,
  contentKey: string,
  roles: { user: string[]; assistant: string[]; system: string[] }
): { role: string; content: string } {
  let role = String(msg[roleKey] ?? '');
  const content = String(msg[contentKey] ?? '');

  if (roles.assistant.includes(role)) {
    role = 'assistant';
  } else if (roles.user.includes(role)) {
    role = 'user';
  } else if (roles.system.includes(role)) {
    role = 'system';
  }

  return { role, content };
}

/**
 * Extract grouping key from a parsed record given its format.
 * Returns undefined if format provides no grouping.
 *
 * Key derivation matches pairs.ts prompt derivation:
 * - flat/candidates: value at promptPath
 * - messages: all turns before last assistant, JSON serialised
 * - preference with promptPath: value at promptPath
 * - preference without promptPath: undefined (no grouping)
 * - unknown: undefined (no grouping)
 */
export function extractGroupKey(
  record: unknown,
  format: RecordFormat
): string | undefined {
  if (format.kind === 'unknown') {
    return undefined;
  }

  if (format.kind === 'flat' || format.kind === 'candidates') {
    const segments = parsePath(format.promptPath);
    const value = getByPath(record, segments);
    return value === undefined ? undefined : String(value);
  }

  if (format.kind === 'preference') {
    if (!format.promptPath) {
      return undefined; // No grouping for implicit prompt
    }
    const segments = parsePath(format.promptPath);
    const value = getByPath(record, segments);
    return value === undefined ? undefined : String(value);
  }

  if (format.kind === 'messages') {
    const segments = parsePath(format.path);
    const messages = getByPath(record, segments);
    if (!Array.isArray(messages) || messages.length === 0) {
      return undefined;
    }

    // Find last assistant turn
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as Record<string, unknown>;
      const role = String(msg[format.roleKey] ?? '');
      if (format.roles.assistant.includes(role)) {
        lastAssistantIdx = i;
        break;
      }
    }

    if (lastAssistantIdx < 0) {
      // No assistant turn found - use all messages as key
      const normalised = messages.map((m) =>
        normaliseMessageForKey(
          m as Record<string, unknown>,
          format.roleKey,
          format.contentKey,
          format.roles
        )
      );
      return JSON.stringify(normalised);
    }

    // Prompt = turns before last assistant
    const prompt = messages.slice(0, lastAssistantIdx).map((m) =>
      normaliseMessageForKey(
        m as Record<string, unknown>,
        format.roleKey,
        format.contentKey,
        format.roles
      )
    );
    return JSON.stringify(prompt);
  }

  return undefined;
}
