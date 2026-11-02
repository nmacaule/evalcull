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
    }
  | {
      kind: 'rows';
      container: 'json' | 'csv' | 'parquet' | 'inspect-eval' | 'promptfoo';
      count: number;
      readRow(i: number): Promise<unknown>;
    };
```

JSONL is byte-indexed (byte-exact export possible). Everything else is row-materialised (re-serialised on export).

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

## Record shapes (auto-detected)

| Shape | Example keys |
|-------|--------------|
| flat | instruction/input/output; prompt/response; question/answer |
| messages | `{"messages":[{"role","content"}]}` |
| shareGPT | `{"conversations":[{"from","value"}]}` |
| gemini | `{"contents":[{"role","parts"}]}` + optional systemInstruction |
| preference | `{"prompt","chosen","rejected"}` |
| candidates | Array of responses per prompt |
| unknown | Fallback → mapping modal |

## Reader completion rule

A reader is done only when it has:

1. A fixture in `tests/fixtures/<format>/`
2. A test case in `tests/readers.test.ts` asserting detected shape, record count, and export promise

## Fixture source of truth

`scripts/create-fixtures.mjs` is the source of truth for JSONL fixture bytes.
Re-run the script rather than hand-editing any `.jsonl` fixture.
