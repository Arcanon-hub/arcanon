---
phase: 112-arcanon-verify-command
type: context
source: discuss-phase
created: 2026-04-21
---

# Phase 112 — `/arcanon:verify` Command — Context

## Phase Goal

A new read-only `/arcanon:verify` command lets users (and Claude) re-check that
cited evidence still exists at the recorded location — returning a per-connection
verdict (`ok` / `moved` / `missing` / `method_mismatch`) so stale scan data can
be detected without re-running a full `/arcanon:map`.

This is Linear THE-1022 item #4 — flagged by the v0.1.0 external reviewer as the
**#1 priority** trust-hardening fix. The scanner can hallucinate; verify is the
read-side check that lets the user trust what they see.

**Requirements covered:** TRUST-01, TRUST-07, TRUST-08, TRUST-09 (4 REQs).

---

## Decisions

### D-01 — Verdict semantics (4 verdicts, exhaustive)

Every connection check returns exactly one of:

| Verdict | Meaning | Trigger |
|---|---|---|
| `ok` | File exists, snippet found within ±3 lines of `line_start` | Happy path — evidence is still there |
| `moved` | File at recorded `source_file` does NOT exist | File was renamed, deleted, or path was wrong from the start. User should rescan. |
| `missing` | File exists, but evidence snippet not found at ±3 lines | Code was edited; weaker signal than `moved`. User can `/arcanon:correct` or rescan. |
| `method_mismatch` | File + evidence present, but the cited HTTP `method` doesn't appear in the snippet | Only checked when the connection has a `method` field. E.g., agent claimed `POST` but only `GET` shown. |

Verdicts are total — every connection gets exactly one. No "warning" / "unknown"
states. The four-verdict surface is part of the public contract documented in
`commands/verify.md` and consumed by future `/arcanon:correct` (v0.1.5).

### D-02 — No write-side effects (read-only command)

`/arcanon:verify` is **purely read-only**. It does NOT:
- Update `connections` rows
- Modify `scan_versions`
- Write to `enrichment_log` (Phase 111's audit table)
- Trigger a rescan

It just reports. The user follows up with:
- `/arcanon:map --rescan` (Phase v0.1.5 — THE-1024) to refresh the whole graph
- `/arcanon:correct` (Phase v0.1.5) to act on individual findings

This keeps verify cheap, idempotent, and safe to run in CI / pre-commit / loops.

### D-03 — Performance + cap

For `/arcanon:verify` (no flags = `--all`):
- Each connection requires one file read (sync), so cost is O(connections).
- **Progress indicator** every 50 connections processed (stderr).
- **Hard cap:** 1000 connections per call. If the latest scan has more, return an
  error code 1 with the message:
  `"too many connections (N > 1000) — scope with --source <path> or --connection <id>"`
- User scopes via `--source` (one source file) or `--connection <id>` (one
  connection) to bypass the cap.

Rationale: keeps the command snappy for the typical case (≤200 connections) and
forces explicit scoping for large monorepo scans rather than silently blocking
the terminal.

### D-04 — Output format (table default, JSON via flag, exit-code-driven)

**Default — human-readable table:**
```
connection_id | verdict          | source_file:line_start            | evidence_excerpt
--------------+------------------+-----------------------------------+----------------------
12            | ok               | src/api/users.ts:42               | router.post('/users'…
13            | moved            | src/api/legacy.ts:88              | (file not found)
14            | missing          | src/api/orders.ts:15              | (snippet not at ±3)
15            | method_mismatch  | src/api/admin.ts:30               | router.get('/admin'…
```

**`--json` flag** — full structured output for piping / CI:
```json
[
  {
    "connection_id": 12,
    "verdict": "ok",
    "source_file": "src/api/users.ts",
    "line_start": 42,
    "line_end": 42,
    "evidence_present": true,
    "snippet": "router.post('/users', ...)",
    "message": null
  }
]
```

**Exit codes:**
- `0` — all verdicts are `ok`
- `1` — at least one non-`ok` verdict (CI-friendly: `verify || rescan`)
- `2` — invocation error (bad flag, invalid `--connection` ID, etc.)

### D-05 — `/api/verify` lives in worker/server/http.js

Add the endpoint alongside existing `/graph`, `/api/impact`, `/api/version`,
`/api/readiness`. New route:

```
GET /api/verify?project=<root>&connection_id=<N>
GET /api/verify?project=<root>&source_file=<rel-path>
GET /api/verify?project=<root>          # all connections in latest scan
```

Returns:
```json
{
  "results": [
    {
      "connection_id": 12,
      "verdict": "ok",
      "source_file": "...",
      "line_start": 42,
      "line_end": 42,
      "evidence_present": true,
      "snippet": "...",
      "message": null
    }
  ],
  "total": 14,
  "truncated": false
}
```

The worker does the file I/O (it already has access to the repo root via the
project query param). The shell wrapper just calls the endpoint and renders.

### D-06 — `--all` is implicit when no flags given

User invocations:
- `/arcanon:verify` → verify ALL connections in latest scan (implicit `--all`)
- `/arcanon:verify --connection 42` → single connection by ID
- `/arcanon:verify --source src/api/users.ts` → all connections whose
  `source_file` matches the path (basename match if given a basename, exact
  match otherwise)
- `/arcanon:verify --json` → JSON output
- Combined: `/arcanon:verify --source src/api/users.ts --json`

**Documented in command help.** No explicit `--all` flag needed.

---

## Plan Structure (2 plans, sequential)

| Plan | Wave | Covers | Outcome |
|---|---|---|---|
| 112-01 — verify command + handler | 1 | TRUST-01 | New `/arcanon:verify` command, `/api/verify` endpoint, shell wrapper |
| 112-02 — bats + node test fixtures | 2 | TRUST-07, TRUST-08, TRUST-09 | bats happy/moved/missing scenarios + http.test.js endpoint coverage |

**Why 2 plans:** Plan 02 depends on Plan 01's command + endpoint existing.
Test fixtures are heavy enough (seed DB + real source files + edge cases) to
warrant a dedicated plan rather than tacking onto 01.

---

## Conventions

- Commit prefix: `feat(112-NN): ...` for code, `test(112-NN): ...` for tests
- REQ refs in commits and code comments: `(TRUST-NN)`
- New files use the `feat(112-01):` prefix; test fixtures use `test(112-02):`

---

## Out of Scope (this phase)

- `/arcanon:correct` — auto-fix moved/missing connections — v0.1.5 (THE-1024)
- `/arcanon:rescan` — rescan a single source file — v0.1.5 (THE-1024)
- Auto-suggesting fixes within `/arcanon:verify` output — v0.1.5
- MCP tool wrapper for `verify` — v0.2.0
- UI rendering of verdicts in the graph — v0.1.6+

---

*Phase 112 context — locked 2026-04-21*
