# HTTP Contract

Both launchers (Node `bin/cli.js` and Python `python -m evalcull`) implement this contract identically.

## Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | — | Serve index.html |
| `/assets/*` | GET | — | Serve static assets |
| `/api/meta` | GET | Host + same-origin | Returns `{ token, name, size, mtimeMs, hasSidecar }` |
| `/api/file` | GET | Host | Serve source file; supports Range header |
| `/api/session` | GET | Host | Read sidecar if exists |
| `/api/session` | PUT | Host + token + same-origin | Write sidecar (atomic via temp + rename) |
| `/api/export?name=` | POST | Host + token + same-origin | Write export file (name must be in allowlist) |
| `/api/done` | POST | Host + token + same-origin | End session: 204, stop serving, print paths, exit 0 |

## Security rules (§2.9)

1. **Host header check (every request):** Must be `127.0.0.1:<port>`, `localhost:<port>`, or `[::1]:<port>`. Anything else → 403 before routing. This is the DNS-rebinding defence.

2. **Loopback only:** Bind to `127.0.0.1`, port 0 (OS-assigned).

3. **Token auth (writes):** `/api/meta` issues a per-session token to same-origin requests only. Write endpoints require `X-Evalcull-Token` header with this token.

4. **Sec-Fetch-Site:** When present, must be `same-origin` or `none` for token-issuing and write endpoints.

## Export allowlist

```
pairs.jsonl
pairs.edits.jsonl
pairs.vertex.jsonl
kept.jsonl
rejected.jsonl
skipped.jsonl
all.decisions.jsonl
```

Any other name, or any path separator → 400.

## /api/done semantics

1. Without token → 403, server continues
2. With token → respond 204
3. Stop accepting connections
4. Print paths of files written beside source during session
5. Exit 0 within 5 seconds
6. Source file bytes unchanged, sidecar intact

**Node:** `res.end()` then `server.close()` (Node 19+ reaps idle keep-alive).

**Python:** respond, then `threading.Thread(target=server.shutdown).start()`.
