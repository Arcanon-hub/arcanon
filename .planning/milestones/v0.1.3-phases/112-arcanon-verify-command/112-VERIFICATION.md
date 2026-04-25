---
phase: 112-arcanon-verify-command
type: phase-closure
plans: 2
requirements: 4
status: complete
completed: 2026-04-25T13:35:00Z
---

# Phase 112 — `/arcanon:verify` Command — Verification

Phase 112 ships TRUST-01 (the command + endpoint) and TRUST-07/08/09 (the test coverage). Both plans are complete; the four-verdict contract is locked by 13 in-process node tests + 7 end-to-end bats tests.

## Plans

| Plan | Wave | Title | Status | Commit(s) |
|------|------|-------|--------|-----------|
| 112-01 | 1 | `/arcanon:verify` command + handler | complete | d29a45a, 42e5417, fb7d6d0 |
| 112-02 | 2 | bats fixtures + node /api/verify tests | complete | 02ffe9d, 880939b |

## Requirements

| REQ | Description | Plan | Verifier |
|-----|-------------|------|----------|
| TRUST-01 | `/arcanon:verify` command — re-read cited evidence at recorded location, return per-connection verdict | 112-01 | manual smoke test in 112-01 SUMMARY |
| TRUST-07 | bats happy-path test — all 3 seeded connections verify ok | 112-02 | tests/verify.bats Test 1 |
| TRUST-08 | bats file-moved test — deleted source file → verdict moved | 112-02 | tests/verify.bats Test 2 |
| TRUST-09 | bats evidence-removed test — overwritten content → verdict missing | 112-02 | tests/verify.bats Test 3 |

All 4 REQs are checked off in REQUIREMENTS.md by the per-plan completion handlers.

## Decision register (CONTEXT.md)

| Decision | Honored | Evidence |
|----------|---------|----------|
| D-01 — 4-verdict total surface (ok / moved / missing / method_mismatch) | ✅ | computeVerdict has exactly 4 verdict return paths. http.verify.test.js Tests 1–4 assert each. |
| D-02 — read-only contract (no writes) | ✅ | http.verify.test.js Test 13 asserts byte-level checksum equality before/after 3 verify calls. `grep INSERT/UPDATE/DELETE` returns nothing in the verify route. |
| D-03 — 1000-connection cap (--all only) | ✅ | http.verify.test.js Test 12 seeds 1001 conns and asserts truncated=true with the scope-with message. |
| D-04 — Output format + exit codes (table default, --json, exit 0/1/2) | ✅ | Per 112-01 exit matrix; bats tests 4–7 assert exit codes 0/1/2 across all branches. |
| D-05 — `/api/verify` lives in worker/server/http.js | ✅ | New fastify route between /api/version and /projects in http.js. |
| D-06 — `--all` implicit when no scope flag given | ✅ | cmdVerify treats absence of --connection / --source as scope=all. http.verify.test.js Tests 6/7/8 cover all three scope flag variants. |

## Test counter delta

| Layer | Pre-112 | Post-112 | Δ |
|-------|---------|----------|---|
| bats — tests/verify.bats | 0 | 7 | +7 |
| node — plugins/arcanon/worker/server/http*.test.js | 38 | 51 | +13 |
| **Phase total** | | | **+20** |

Phase 113 (VER-01 baseline counter) should add `tests/verify.bats` to its bats list and `plugins/arcanon/worker/server/http.verify.test.js` to its node test list.

## Read-only contract proof (D-02)

Re-grep at phase close:

```bash
$ grep -E "INSERT|UPDATE|DELETE" plugins/arcanon/worker/server/http.js | grep -in verify
# (empty)
```

Plus the formal byte-level checksum assertion in `http.verify.test.js` Test 13:

```js
const before = checksumTables(db);
await server.inject({ ... /api/verify?project=... });           // scope=all
await server.inject({ ... /api/verify?connection_id=1 });       // scope=connection
await server.inject({ ... /api/verify?source_file=... });       // scope=source
const after = checksumTables(db);
assert.deepEqual(after.conn, before.conn);
assert.deepEqual(after.sv, before.sv);
```

Tables byte-identical after every scope branch is exercised → D-02 verified.

## Out-of-scope items (deferred to v0.1.5)

Per CONTEXT.md "Out of Scope" section, the following are explicitly NOT shipped in this phase and are tracked for v0.1.5 (THE-1024):

- `/arcanon:correct` — auto-fix moved/missing connections
- `/arcanon:rescan` — rescan a single source file
- Auto-suggesting fixes within `/arcanon:verify` output
- MCP tool wrapper for `verify` (v0.2.0)
- UI rendering of verdicts in the graph (v0.1.6+)

## Closure

Phase 112 is complete. Both plans shipped, all 4 requirements verified, all 6 decisions honored, test counter advanced by +20.

Next phase: 113 — Verification Gate (VER-01).
