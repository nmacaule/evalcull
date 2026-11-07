# evalcull

Opens any eval or training file, keyboard-first, writes back, nothing to set up.

Runs in Chrome 111, Safari 16.4, Firefox 128 or newer. CI runs the single file from disk in Playwright 1.64.1's Chromium 156, WebKit 27.2 and Firefox 157 on Linux, and in its WebKit and Firefox on macOS and Windows; the file was also checked by hand from disk in Safari 26.6.2 on macOS.

This first release reads JSONL: conversations (`messages`, including ShareGPT), preference pairs (`chosen` / `rejected`), multi-candidate records, and prompt/response rows. Other formats follow.

**Try it:** [nmacaule.github.io/evalcull](https://nmacaule.github.io/evalcull/) or [huggingface.co/spaces/evalcull/demo](https://huggingface.co/spaces/evalcull/demo). Press one of the "Open sample" buttons, or drop your own `.jsonl` file on the page.

## Your file stays on your machine

The page makes no network requests: open your browser's network tab, load a file, and it stays empty. A Content-Security-Policy in the page forbids any connection (`connect-src 'none'`), so this holds even if something tried. Files are read by your browser; exports are downloads your browser writes.

## Exports keep your bytes

Lines you did not edit are copied byte for byte, line endings and all, so an export with no edits is identical to its source. Only the lines you edited are re-serialised, and their numbers keep their exact digits and formatting (`9007199254740993`, `1.0`, `1e3`). A byte-order mark can be kept, stripped or added.

- `kept.jsonl`, `rejected.jsonl`, `skipped.jsonl`: the records you marked.
- `pairs.jsonl`: preference pairs in TRL's format, one row per pair you judged; ties and both-unacceptable pairs are left out and counted.
- `pairs.edits.jsonl`: pairs of an original and your edit.
- `all.decisions.jsonl`: every record with your decisions under `_triage`.

## Keys

| Key | Compare mode | Single mode |
| --- | --- | --- |
| ← / → (or 1 / 2) | Prefer left / right | — |
| = (or 0) | Tie | — |
| X | Both unacceptable | — |
| Shift+1–3 | Strength of the pair just judged | — |
| A / R / S | Keep / Reject / Skip the focused candidate | Keep / Reject / Skip |
| Tab | Move focus between candidates | — |
| E | Edit; Mod+Enter saves, Esc cancels | Same |
| J / K | Next / previous prompt | Next / previous record |
| U / Shift+U | Undo / redo | Same |
| T / W / M | Raw view; whitespace; metadata | Same |
| L / N | Labels / notes | Same |
| G, /, F, ? | Go to, search, filter, all keys | Same |

A prompt with more than two candidates is judged as a knockout: the preferred candidate stays and meets the next, so N candidates take N−1 judgements.

## One file, no install

The demo is a single `index.html` with everything inlined. Save it and open it from your disk; it works offline. Your progress is kept in the browser's storage where the browser allows it, which is not guaranteed for a file opened from disk; use **Export → Download session** to keep it, and **Load session** to continue later.

To build it yourself (Node 22.12 or newer): `npm ci && npm run build:single`, then open `dist/index.html`.

## Licence

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The built page inlines third-party code under permissive licences (MIT, ISC, 0BSD, Apache-2.0 and others); their notices are in `THIRD-PARTY-NOTICES` beside the page and at the end of the page itself.
