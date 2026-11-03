import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildPairs } from '../src/lib/pairs';
import type { CandidateRef, Decision, RecordFormat } from '../src/types';

const pairsFixturesDir = join(import.meta.dirname, 'fixtures', 'pairs');

interface PairsFixture {
  description: string;
  format?: RecordFormat;
  records: unknown[];
  decisions: Record<string, Decision>;
  expectedPairs: unknown[];
  expectedEditPairs: unknown[];
  expectedImplicitPromptCount?: number;
  note?: string;
}

function getFixtureNames(): string[] {
  return readdirSync(pairsFixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

describe('buildPairs (WP 4)', () => {
  const fixtures = getFixtureNames();

  it.each(fixtures)('%s: pairs match expected', (name) => {
    const fixture: PairsFixture = JSON.parse(
      readFileSync(join(pairsFixturesDir, `${name}.json`), 'utf-8')
    );

    // Convert decisions object to Map
    const decisions = new Map<CandidateRef, Decision>();
    for (const [ref, decision] of Object.entries(fixture.decisions)) {
      decisions.set(ref, decision);
    }

    // Format is required in the fixture schema
    const format: RecordFormat = fixture.format!;

    // Build getRecord function
    const getRecord = (i: number) => fixture.records[i];

    const result = buildPairs(decisions, format, getRecord);

    // Check pairs match expected
    expect(result.pairs).toEqual(fixture.expectedPairs);
    expect(result.editPairs).toEqual(fixture.expectedEditPairs);

    // Check implicit prompt count if specified
    if (fixture.expectedImplicitPromptCount !== undefined) {
      expect(result.implicitPromptCount).toBe(fixture.expectedImplicitPromptCount);
    }
  });

  it('tie-excluded: ties are excluded and counted', () => {
    const fixture: PairsFixture = JSON.parse(
      readFileSync(join(pairsFixturesDir, 'tie-excluded.json'), 'utf-8')
    );

    const decisions = new Map<CandidateRef, Decision>();
    for (const [ref, decision] of Object.entries(fixture.decisions)) {
      decisions.set(ref, decision);
    }

    const format: RecordFormat = {
      kind: 'candidates',
      promptPath: 'prompt',
      candidatesPath: 'candidates',
    };

    const result = buildPairs(decisions, format, (i) => fixture.records[i]);

    expect(result.pairs).toHaveLength(0);
    expect(result.excludedTies).toBe(1);
  });

  it('both-bad-excluded: both_bad are excluded and counted', () => {
    const fixture: PairsFixture = JSON.parse(
      readFileSync(join(pairsFixturesDir, 'both-bad-excluded.json'), 'utf-8')
    );

    const decisions = new Map<CandidateRef, Decision>();
    for (const [ref, decision] of Object.entries(fixture.decisions)) {
      decisions.set(ref, decision);
    }

    const format: RecordFormat = {
      kind: 'candidates',
      promptPath: 'prompt',
      candidatesPath: 'candidates',
    };

    const result = buildPairs(decisions, format, (i) => fixture.records[i]);

    expect(result.pairs).toHaveLength(0);
    expect(result.excludedBothBad).toBe(1);
  });

  it('no-compare-no-pair: Keep/Reject alone yields zero pairs', () => {
    const fixture: PairsFixture = JSON.parse(
      readFileSync(join(pairsFixturesDir, 'no-compare-no-pair.json'), 'utf-8')
    );

    const decisions = new Map<CandidateRef, Decision>();
    for (const [ref, decision] of Object.entries(fixture.decisions)) {
      decisions.set(ref, decision);
    }

    const format: RecordFormat = {
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    };

    const result = buildPairs(decisions, format, (i) => fixture.records[i]);

    expect(result.pairs).toHaveLength(0);
    expect(result.editPairs).toHaveLength(0);
  });

  it('implicit-prompt: preference without promptPath yields implicit-prompt rows', () => {
    const fixture: PairsFixture = JSON.parse(
      readFileSync(join(pairsFixturesDir, 'implicit-prompt.json'), 'utf-8')
    );

    const decisions = new Map<CandidateRef, Decision>();
    for (const [ref, decision] of Object.entries(fixture.decisions)) {
      decisions.set(ref, decision);
    }

    const format = fixture.format!;
    const result = buildPairs(decisions, format, (i) => fixture.records[i]);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).not.toHaveProperty('prompt');
    expect(result.pairs[0]).toHaveProperty('chosen');
    expect(result.pairs[0]).toHaveProperty('rejected');
  });

  it('sharegpt-multi-turn: from/value normalised to role/content, gpt to assistant', () => {
    const fixture: PairsFixture = JSON.parse(
      readFileSync(join(pairsFixturesDir, 'sharegpt-multi-turn.json'), 'utf-8')
    );

    const decisions = new Map<CandidateRef, Decision>();
    for (const [ref, decision] of Object.entries(fixture.decisions)) {
      decisions.set(ref, decision);
    }

    const format = fixture.format!;
    const result = buildPairs(decisions, format, (i) => fixture.records[i]);

    // Should have edit pairs, not compare pairs
    expect(result.pairs).toHaveLength(0);
    expect(result.editPairs).toHaveLength(1);

    const editPair = result.editPairs[0] as { prompt: unknown[]; chosen: unknown[]; rejected: unknown[] };

    // Check normalisation: role/content keys, assistant/user/system roles
    expect(editPair.prompt).toHaveLength(4);
    expect(editPair.prompt[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
    expect(editPair.prompt[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(editPair.prompt[2]).toEqual({ role: 'assistant', content: 'Hi there!' });
    expect(editPair.prompt[3]).toEqual({ role: 'user', content: 'How are you?' });

    expect(editPair.chosen).toHaveLength(1);
    expect(editPair.chosen[0]).toEqual({ role: 'assistant', content: "I'm doing great, thank you for asking!" });

    expect(editPair.rejected).toHaveLength(1);
    expect(editPair.rejected[0]).toEqual({ role: 'assistant', content: "I'm doing well, thanks!" });
  });

  it('unparseable records are skipped and counted', () => {
    const records = [
      { prompt: 'Q1', candidates: ['A1', 'B1'] },
      { prompt: 'Q2', candidates: ['A2', 'B2'] },
    ];

    const decisions = new Map<CandidateRef, Decision>();
    decisions.set('0', {
      status: 'unreviewed',
      compare: { left: '0:0', right: '0:1', preference: 'left' },
      updatedAt: Date.now(),
    });
    decisions.set('1', {
      status: 'unreviewed',
      compare: { left: '1:0', right: '1:1', preference: 'right' },
      updatedAt: Date.now(),
    });

    const format: RecordFormat = {
      kind: 'candidates',
      promptPath: 'prompt',
      candidatesPath: 'candidates',
    };

    // Mark line 0 as unparseable
    const isUnparseable = (i: number) => i === 0;

    const result = buildPairs(decisions, format, (i) => records[i], isUnparseable);

    // Line 0 should be skipped
    expect(result.pairs).toHaveLength(1);
    expect(result.skippedUnparseable).toBe(1);
  });
});
