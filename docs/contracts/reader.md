# Reader Contract

## RecordSource interface

Every reader produces a `RecordSource`:

```typescript
type RecordSource =
  | {
      kind: 'jsonl';
      index: FileIndex;
      readText(i: number): Promise<string>;
      readRaw(i: number): Promise<Blob>;
      readRawRange(from: number, to: number): Promise<Blob>;
    }
  | {
      kind: 'rows';
      container: 'json' | 'csv' | 'parquet' | 'inspect-eval' | 'promptfoo';
      count: number;
      readRow(i: number): Promise<unknown>;
    };
```

JSONL is byte-indexed (byte-exact export possible). Everything else is row-materialised (re-serialised on export).

`readRawRange(from, to)` returns the raw bytes of lines `from..to` inclusive, terminators included, as one Blob slice; line 0 keeps its BOM, as in `readRaw`. The exporter reads each run of unedited included lines with one call, so an export builds one Blob part per run rather than one per line (owner decision, 4 Nov 2026, WP 6c, D-006).

## Containers and export promises

| Container | Reader | Export promise |
|-----------|--------|----------------|
| .jsonl | Byte-offset index in Web Worker | Byte-exact for unedited lines |
| .json array | Native JSON, materialised rows | Re-serialised as JSONL |
| .csv | papaparse, materialised rows | Re-serialised as JSONL |
| .parquet | hyparquet, row groups on demand | Re-serialised as JSONL |
| Inspect .eval | fflate (ZIP), samples become records | Decisions as JSONL; original untouched |
| Promptfoo results | Each test → prompt with candidates; ratings imported | Pairs and decisions as JSONL |
| Vertex .jsonl | contents/parts → conversation shape | Byte-exact (it is JSONL) |

## Record shapes (auto-detected, WP 5)

| Shape | Example keys | Detection rule |
|-------|--------------|----------------|
| flat | instruction/input/output; prompt/response; question/answer | Prompt-like + response-like keys, both strings |
| messages | `{"messages":[{"role","content"}]}` | Array with role/content elements |
| shareGPT | `{"conversations":[{"from","value"}]}` | Array with from/value elements (detected as messages) |
| gemini | `{"contents":[{"role","parts"}]}` | Detects as unknown; WP 12 Vertex reader maps it |
| preference | `{"prompt","chosen","rejected"}` | chosen + rejected keys; prompt optional |
| candidates | Array of string responses per prompt | String array + prompt-like key |
| unknown | Fallback → mapping modal | < 80% sample matches any shape |

### Detection parameters

- Sample size: up to 10 parseable records
- Match threshold: ≥ 80% of sample AND at least one record
- Tie order: preference > messages > candidates > flat

## Grouping (WP 5)

| Format kind | Grouping key |
|-------------|--------------|
| flat | Value at promptPath |
| messages | All turns before last assistant, JSON serialised |
| preference with promptPath | Value at promptPath |
| preference without promptPath | No grouping (each record own group) |
| candidates | Value at promptPath |
| unknown | No grouping (each record own group) |
| Unparseable lines | Each line its own singleton group |

Hash: FNV-1a 32-bit (lo) + djb2 32-bit (hi) for 64-bit composite.
Collision probability: ~3e-8 at 1M distinct prompts.

A format change from the mapping modal re-runs the second pass through the
reader's `regroup()`, which recomputes `groups`, `groupCount`, `unparseable`
and `candidates`.

## Candidates per line (WP 6c)

The second pass also records each line's candidate count for the format in
`FileIndex.candidates: Uint16Array` (PRD v3.3 §3.3):

| Line | Count |
|------|-------|
| Unparseable | 0 |
| Row formats (flat, messages, unknown) | 1 |
| candidates | Array length at `candidatesPath`; 0 when missing or not an array; capped at 65535 |
| preference | 2 (k 0 = `chosenPath`, k 1 = `rejectedPath`) |

A prompt is a group of lines. Its compare decisions live on the ref of the
group's first line. Its candidates are the group's lines' own refs (`"i"`) for
row formats, and `"i:k"` for each line i and each k below that line's count for
in-record formats.

## Reader completion rule

A reader is done only when it has:

1. A fixture in `tests/fixtures/<format>/`
2. A test case in `tests/readers.test.ts` asserting detected shape, record count, and export promise

## Fixture source of truth

`scripts/create-fixtures.mjs` is the source of truth for JSONL fixture bytes.
Re-run the script rather than hand-editing any `.jsonl` fixture.
