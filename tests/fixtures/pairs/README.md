# Pairs fixtures

JSON fixtures for testing `buildPairs` (TS) and `pairs.py` (Python, WP 10).

Written in WP 4 (2 Nov 2026). The six WP 1 fixtures gained format fields at
that time; no schema existed before. Updated in WP 6c (PRD v3.3): `compare` is
an array, the ref model is stated below, and three knockout fixtures were added.

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
    "<CandidateRef>": {
      "status": "...",
      "compare": [{ "left": "<CandidateRef>", "right": "<CandidateRef>", "preference": "left | right | tie | both_bad", "strength": 1 }],
      "edits": {...},
      ...
    }
  },
  "expectedPairs": [...],
  "expectedEditPairs": [...],
  "expectedImplicitPromptCount": 0,
  "expectedExcluded": { "ties": 0, "bothBad": 0 },
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
- `expectedExcluded`: `{ ties, bothBad }`, the compare elements left out of
  `expectedPairs` because they are ties or both_bad (WP 6c)
- `note`: Additional notes

## Compare decisions (PRD v3.3)

`compare` is an array with one element per judged pair, in judgement order.
`strength` (1–3) is optional and lives inside each element. Each element with
preference `left` or `right` yields one pair; `tie` and `both_bad` yield none
and are counted in `expectedExcluded`.

A prompt with N candidates is judged as a knockout in N−1 pairs: candidate 0
meets candidate 1, and the preferred one stays and meets the next. On a tie or
both_bad the incumbent stays; in round 1 that is candidate 0. From round 2 the
incumbent is on the right in even rounds and on the left in odd rounds. The
stored `left`/`right` refs are the refs that were shown, so a pair is read from
its element alone.

## Refs

A ref names a line: `"i"` is line i, and `"i:k"` is candidate k inside line i.

- `compare` lives on the ref of the prompt group's first line.
- Row formats (`flat`, `messages`): each candidate is a whole line, so its ref
  is that line's own ref `"i"`. The prompt text comes from the first line.
- In-record formats (`candidates`, `preference`): candidates are `"i:k"`.
  For `candidates`, k indexes `candidatesPath`; for `preference`, k 0 is
  `chosenPath` and k 1 is `rejectedPath`.
- chosen and rejected are always read from each candidate's own ref.

## Knockout fixtures (WP 6c)

- `knockout-four-candidates.json`: one record with four candidates judged in
  three pairs; three rows in judgement order.
- `knockout-tie-middle.json`: the same record with a tie in round 2; two rows,
  one tie excluded.
- `rows-sharing-prompt.json`: flat rows with prompts A, B, A, C, B, A on lines
  0–5, so group ids differ from first lines; prompt A is judged through two
  pairs with line refs.

## Format kinds

- `messages`: Multi-turn conversation with `path`, `roleKey`, `contentKey`, `roles`
- `flat`: Single prompt/response with `promptPath`, `responsePath`
- `candidates`: Multiple candidates with `promptPath`, `candidatesPath`
- `preference`: Pre-paired chosen/rejected with `chosenPath`, `rejectedPath`, optional `promptPath`
