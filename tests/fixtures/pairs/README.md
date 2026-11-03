# Pairs fixtures

JSON fixtures for testing `buildPairs` (TS) and `pairs.py` (Python, WP 10).

Written in WP 4 (2 Nov 2026). The six WP 1 fixtures gained format fields at
that time; no schema existed before.

## Schema

```json
{
  "description": "Human-readable description of test case",
  "format": {
    "kind": "messages | flat | candidates | preference",
    ...format-specific fields
  },
  "records": [...],
  "decisions": {
    "<CandidateRef>": { "status": "...", "edits": {...}, ... }
  },
  "expectedPairs": [...],
  "expectedEditPairs": [...],
  "expectedImplicitPromptCount": 0,
  "note": "Optional notes"
}
```

### Required fields

- `description`: What this test case covers
- `format`: RecordFormat object (kind plus format-specific fields)
- `records`: Array of record objects
- `decisions`: Object keyed by CandidateRef
- `expectedPairs`: Expected compare pairs output
- `expectedEditPairs`: Expected edit pairs output

### Optional fields

- `expectedImplicitPromptCount`: Count of pairs without prompt field
- `note`: Additional notes

## Format kinds

- `messages`: Multi-turn conversation with `path`, `roleKey`, `contentKey`, `roles`
- `flat`: Single prompt/response with `promptPath`, `responsePath`
- `candidates`: Multiple candidates with `promptPath`, `candidatesPath`
- `preference`: Pre-paired chosen/rejected with `chosenPath`, `rejectedPath`, optional `promptPath`
