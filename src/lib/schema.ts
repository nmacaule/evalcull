/**
 * Shape detection for JSONL records.
 *
 * Detects: flat, messages (OpenAI/ShareGPT), preference, candidates, unknown.
 * Tie order: preference > messages > candidates > flat.
 */

import type { RecordFormat } from '../types';

export interface DetectResult {
  format: RecordFormat;
  confidence: 'exact' | 'partial' | 'none';
}

// Prompt-like keys
const PROMPT_KEYS = ['instruction', 'prompt', 'question', 'input'];
// Response-like keys
const RESPONSE_KEYS = ['output', 'response', 'answer', 'completion'];

// Role mappings for auto-detection
const USER_ROLES = ['user', 'human'];
const ASSISTANT_ROLES = ['assistant', 'gpt', 'model', 'bot'];
const SYSTEM_ROLES = ['system'];

interface ShapeMatch {
  shape: 'flat' | 'messages' | 'preference' | 'candidates';
  format: RecordFormat;
  count: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasKey(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) {
      return key;
    }
  }
  return null;
}

function isStringArray(arr: unknown[]): boolean {
  return arr.every((item) => typeof item === 'string');
}

/**
 * Check if record matches flat shape: prompt-like + response-like keys, both strings.
 */
function matchFlat(record: unknown): RecordFormat | null {
  if (!isObject(record)) return null;

  const promptKey = hasKey(record, PROMPT_KEYS);
  const responseKey = hasKey(record, RESPONSE_KEYS);

  if (
    promptKey &&
    responseKey &&
    typeof record[promptKey] === 'string' &&
    typeof record[responseKey] === 'string'
  ) {
    return {
      kind: 'flat',
      promptPath: promptKey,
      responsePath: responseKey,
    };
  }
  return null;
}

/**
 * Check if record matches messages shape (OpenAI or ShareGPT).
 */
function matchMessages(record: unknown): RecordFormat | null {
  if (!isObject(record)) return null;

  // OpenAI style: messages array with role/content
  if ('messages' in record && Array.isArray(record.messages)) {
    const messages = record.messages as unknown[];
    if (messages.length > 0) {
      const first = messages[0];
      if (isObject(first) && 'role' in first && 'content' in first) {
        // Collect distinct roles
        const roles = new Set<string>();
        for (const msg of messages) {
          if (isObject(msg) && typeof msg.role === 'string') {
            roles.add(msg.role);
          }
        }
        return {
          kind: 'messages',
          path: 'messages',
          roleKey: 'role',
          contentKey: 'content',
          roles: buildRolesObject(roles),
        };
      }
    }
  }

  // ShareGPT style: conversations array with from/value
  if ('conversations' in record && Array.isArray(record.conversations)) {
    const convs = record.conversations as unknown[];
    if (convs.length > 0) {
      const first = convs[0];
      if (isObject(first) && 'from' in first && 'value' in first) {
        const roles = new Set<string>();
        for (const msg of convs) {
          if (isObject(msg) && typeof msg.from === 'string') {
            roles.add(msg.from);
          }
        }
        return {
          kind: 'messages',
          path: 'conversations',
          roleKey: 'from',
          contentKey: 'value',
          roles: buildRolesObject(roles),
        };
      }
    }
  }

  return null;
}

/**
 * Build roles object from detected role values.
 */
function buildRolesObject(
  roleValues: Set<string>
): { user: string[]; assistant: string[]; system: string[] } {
  const user: string[] = [];
  const assistant: string[] = [];
  const system: string[] = [];

  for (const role of roleValues) {
    const lower = role.toLowerCase();
    if (USER_ROLES.includes(lower)) {
      user.push(role);
    } else if (ASSISTANT_ROLES.includes(lower)) {
      assistant.push(role);
    } else if (SYSTEM_ROLES.includes(lower)) {
      system.push(role);
    } else {
      // Unknown role - default to user
      user.push(role);
    }
  }

  // Ensure at least empty arrays
  return { user, assistant, system };
}

/**
 * Check if record matches preference shape: chosen + rejected, optional prompt.
 */
function matchPreference(record: unknown): RecordFormat | null {
  if (!isObject(record)) return null;

  if ('chosen' in record && 'rejected' in record) {
    const promptKey = hasKey(record, PROMPT_KEYS);
    if (promptKey) {
      return {
        kind: 'preference',
        promptPath: promptKey,
        chosenPath: 'chosen',
        rejectedPath: 'rejected',
      };
    }
    return {
      kind: 'preference',
      chosenPath: 'chosen',
      rejectedPath: 'rejected',
    };
  }
  return null;
}

/**
 * Check if record matches candidates shape:
 * - Array of strings at a key that is not messages/conversations
 * - Plus a prompt-like key beside it
 */
function matchCandidates(record: unknown): RecordFormat | null {
  if (!isObject(record)) return null;

  const promptKey = hasKey(record, PROMPT_KEYS);
  if (!promptKey) return null;

  // Look for an array of strings that isn't messages/conversations
  for (const [key, value] of Object.entries(record)) {
    if (key === 'messages' || key === 'conversations') continue;
    if (key === promptKey) continue;

    if (Array.isArray(value) && value.length > 0 && isStringArray(value)) {
      return {
        kind: 'candidates',
        promptPath: promptKey,
        candidatesPath: key,
      };
    }
  }

  return null;
}

/**
 * Detect record format from sampled records.
 *
 * @param records Up to K parseable records (K = 10)
 * @returns Detected format and confidence
 *
 * Match rule: shape matches when >=80% of sample fits AND at least one record does.
 * Exact = 100%. Partial = 80-99%. None = <80% -> unknown.
 *
 * Tie order: preference > messages > candidates > flat.
 */
export function detectFormat(records: unknown[]): DetectResult {
  if (records.length === 0) {
    return { format: { kind: 'unknown' }, confidence: 'none' };
  }

  const matches: ShapeMatch[] = [];

  // Count matches for each shape
  let preferenceCount = 0;
  let preferenceFormat: RecordFormat | null = null;
  let messagesCount = 0;
  let messagesFormat: RecordFormat | null = null;
  // Collect all roles across all messages records for merging
  const allMessagesRoles = new Set<string>();
  let candidatesCount = 0;
  let candidatesFormat: RecordFormat | null = null;
  let flatCount = 0;
  let flatFormat: RecordFormat | null = null;

  // Track promptPath presence for preference majority rule
  let prefWithPrompt = 0;
  let prefWithoutPrompt = 0;

  for (const record of records) {
    // Check each shape in priority order
    const pref = matchPreference(record);
    if (pref) {
      preferenceCount++;
      if (!preferenceFormat) preferenceFormat = pref;
      if (pref.kind === 'preference' && pref.promptPath) {
        prefWithPrompt++;
      } else {
        prefWithoutPrompt++;
      }
    }

    const msgs = matchMessages(record);
    if (msgs) {
      messagesCount++;
      if (!messagesFormat) {
        messagesFormat = msgs;
      }
      // Merge roles from all records (msgs is messages format with roles)
      if (msgs.kind === 'messages') {
        for (const r of msgs.roles.user) allMessagesRoles.add(r);
        for (const r of msgs.roles.assistant) allMessagesRoles.add(r);
        for (const r of msgs.roles.system) allMessagesRoles.add(r);
      }
    }

    const cands = matchCandidates(record);
    if (cands) {
      candidatesCount++;
      if (!candidatesFormat) candidatesFormat = cands;
    }

    const flat = matchFlat(record);
    if (flat) {
      flatCount++;
      if (!flatFormat) flatFormat = flat;
    }
  }

  // Collect matches meeting threshold
  const total = records.length;
  const threshold = Math.ceil(total * 0.8);

  if (preferenceCount >= threshold && preferenceCount >= 1) {
    // Apply promptPath majority rule
    let finalFormat = preferenceFormat!;
    if (prefWithPrompt > prefWithoutPrompt && finalFormat.kind === 'preference') {
      // Majority have prompt - ensure promptPath is set
      if (!finalFormat.promptPath) {
        // Find a record with prompt to get the key
        for (const record of records) {
          if (isObject(record)) {
            const promptKey = hasKey(record, PROMPT_KEYS);
            if (promptKey) {
              finalFormat = {
                kind: 'preference',
                promptPath: promptKey,
                chosenPath: 'chosen',
                rejectedPath: 'rejected',
              };
              break;
            }
          }
        }
      }
    } else if (prefWithoutPrompt > prefWithPrompt && finalFormat.kind === 'preference') {
      // Majority without prompt - remove promptPath
      finalFormat = {
        kind: 'preference',
        chosenPath: 'chosen',
        rejectedPath: 'rejected',
      };
    }
    matches.push({
      shape: 'preference',
      format: finalFormat,
      count: preferenceCount,
    });
  }

  if (messagesCount >= threshold && messagesCount >= 1) {
    // Rebuild format with merged roles from all records
    const mergedFormat = messagesFormat!;
    if (mergedFormat.kind === 'messages') {
      mergedFormat.roles = buildRolesObject(allMessagesRoles);
    }
    matches.push({
      shape: 'messages',
      format: mergedFormat,
      count: messagesCount,
    });
  }

  if (candidatesCount >= threshold && candidatesCount >= 1) {
    matches.push({
      shape: 'candidates',
      format: candidatesFormat!,
      count: candidatesCount,
    });
  }

  if (flatCount >= threshold && flatCount >= 1) {
    matches.push({
      shape: 'flat',
      format: flatFormat!,
      count: flatCount,
    });
  }

  if (matches.length === 0) {
    return { format: { kind: 'unknown' }, confidence: 'none' };
  }

  // Apply tie-breaker: preference > messages > candidates > flat
  const priority: Record<string, number> = {
    preference: 4,
    messages: 3,
    candidates: 2,
    flat: 1,
  };

  matches.sort((a, b) => priority[b.shape] - priority[a.shape]);

  const best = matches[0];
  const confidence = best.count === total ? 'exact' : 'partial';

  return { format: best.format, confidence };
}

/**
 * Merge detected roles from sample records into existing roles object.
 * For modal role reassignment.
 */
export function collectRoles(
  records: unknown[],
  path: string,
  roleKey: string
): Set<string> {
  const roles = new Set<string>();

  for (const record of records) {
    if (!isObject(record)) continue;

    // Simple path lookup (handles single key or nested path)
    let target: unknown = record;
    for (const segment of path.split('.')) {
      if (!isObject(target)) break;
      target = (target as Record<string, unknown>)[segment];
    }

    if (!Array.isArray(target)) continue;

    for (const msg of target) {
      if (isObject(msg) && typeof msg[roleKey] === 'string') {
        roles.add(msg[roleKey] as string);
      }
    }
  }

  return roles;
}
