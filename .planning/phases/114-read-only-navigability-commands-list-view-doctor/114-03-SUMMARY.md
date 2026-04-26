---
phase: 114-read-only-navigability-commands-list-view-doctor
plan: 03
subsystem: arcanon-plugin / cli
tags: [nav-03, read-only, command-surface, navigability, diagnostics, doctor]
requirements_completed: [NAV-03]
dependency_graph:
  requires:
    - "plugins/arcanon/lib/worker-client.sh _arcanon_is_project_dir (114-01)"
    - "plugins/arcanon/worker/db/pool.js projectHashDir export (114-01)"
    - "plugins/arcanon/worker/server/http.js GET /api/readiness + GET /api/version (existing)"
    - "plugins/arcanon/worker/hub-sync resolveCredentials (existing)"
    - "plugins/arcanon/lib/data-dir.sh resolveDataDir / resolve_arcanon_data_dir (existing)"
    - "plugins/arcanon/lib/config-path.js resolveConfigPath (existing)"
    - "plugins/arcanon/worker/mcp/server.js (existing — spawned by check 7)"
    - "better-sqlite3 (existing dependency, ^12.9.0)"
  provides:
    - "plugins/arcanon/worker/cli/hub.js fetchWithTimeout — module-private bounded fetch with normalized {ok,status,json,elapsedMs,error} contract"
    - "plugins/arcanon/worker/cli/hub.js runCheck — 2s-timeout wrapper for diagnostic check fns"
    - "plugins/arcanon/worker/cli/hub.js cmdDoctor — registered in HANDLERS as `doctor: cmdDoctor`, dispatched by /arcanon:doctor"
    - "plugins/arcanon/tests/fixtures/doctor/seed.sh — wraps list-fixture seeder; supports --no-scan and --schema-version flags"
    - "plugins/arcanon/tests/fixtures/doctor/mock-hub.js — 17-line http server on 127.0.0.1:37996 returning 200 {\"version\":\"x\"} for /api/version"
  affects:
    - "tests/commands-surface.bats iteration list — extended from 11 to 12 commands (added `doctor`); +2 NAV-03 @test blocks"
tech_stack:
  added:
    - "node:child_process spawn (already in stdlib; first use in hub.js)"
  patterns:
    - "isolated read-only SQLite connections that bypass the openDb() process-cached singleton — required because db.close() on the singleton would break subsequent worker queries (BLOCK 2)"
    - "filesystem-glob computation of authoritative migration head (no constant; forward-compatible with future migrations)"
    - "child_process spawn liveness probe for stdio-based subprocesses (Option B per FLAG 5 — deadline-survival as proof of message-loop readiness)"
    - "PID-suffixed probe file for write-permission test (T-114-03-02 mitigation)"
    - "module-private fetchWithTimeout helper with normalized result contract — eliminates try/catch boilerplate in 3 of 8 checks"
key_files:
  created:
    - "plugins/arcanon/commands/doctor.md (slash-command markdown wrapper, ~70 lines)"
    - "plugins/arcanon/tests/fixtures/doctor/seed.sh (delegates to list seeder + optional schema downgrade)"
    - "plugins/arcanon/tests/fixtures/doctor/mock-hub.js (17-line http stub for Test 9)"
    - "tests/doctor.bats (12-test bats E2E suite, repo-root location)"
  modified:
    - "plugins/arcanon/worker/cli/hub.js (+cmdDoctor, +fetchWithTimeout, +runCheck, +formatDoctorTable, +HANDLERS registration, +imports for spawn / Database)"
    - "tests/commands-surface.bats (iteration list 11 → 12; +2 NAV-03 @test blocks)"
    - "plugins/arcanon/CHANGELOG.md (Added entry under [Unreleased])"
decisions:
  - "Option B / liveness probe for check 7 over Option A / full handshake (per FLAG 5). Smoke test, not a conformance test. Most MCP-server breakage is import-time — liveness covers that. ~25 lines vs ~80 lines for full handshake."
  - "Filesystem glob for migration head over a hardcoded constant (per RESEARCH §7 Q2). Forward-compatible with Phase 117 (017_scan_overrides.js) — no source change required when a new migration lands."
  - "Fresh isolated read-only Database connection for checks 3 and 6 (BLOCK 2). The worker's openDb() returns a process-cached singleton AND auto-runs migrations; calling db.close() on it would break subsequent worker queries and silently trigger migrations from a diagnostic command — both unacceptable for a read-only doctor."
  - "fetchWithTimeout helper with documented {ok,status,json,elapsedMs,error} contract. Used by checks 1, 2, 8 — same shape eliminates try/catch boilerplate at three callsites."
  - "--json flag honored for parity with every other hub.js command (per RESEARCH §7 Q5). Enables CI / pre-release-gate integration."
  - "8 checks (not 7 as the ROADMAP intro prose claims; matches REQUIREMENTS.md NAV-03). See Discrepancies below."
  - "Markdown wrapper auto-starts the worker (matches /arcanon:list and /arcanon:view patterns) so /arcanon:doctor from a clean shell Just Works."
  - "Tests invoking the worker-unreachable scenario (Test 5b) bypass the markdown wrapper by calling `bash plugins/arcanon/scripts/hub.sh doctor` directly — the wrapper would auto-start the worker and prevent the failure path from firing."
  - "Per-test HOME isolation (`export HOME=$BATS_TEST_TMPDIR/home`). resolveCredentials reads `os.homedir()/.arcanon/config.json` (NOT $ARCANON_DATA_DIR), so without per-test HOME isolation the user's real ~/.arcanon would leak into the test environment."
  - "Test 9 mock-hub binds to port 37996 — sibling to bats-doctor worker (37997), bats-list worker (37998), bats-verify worker (37999). No collision."
metrics:
  duration: "~75 minutes (planning context load → final commit)"
  tasks_completed: 2 / 2
  files_created: 4
  files_modified: 3
  tests_added: 12 (doctor.bats) + 2 (commands-surface.bats NAV-03 block) = 14 net new
  tests_passing: 26 / 26 (bats tests/doctor.bats tests/commands-surface.bats tests/list.bats)
  full_suite: 339 / 340 (sole failure is pre-existing macOS HOK-06 p99 latency — documented platform constraint in STATE.md, not introduced by this plan)
  completed_date: 2026-04-25
---

# Phase 114 Plan 03: `/arcanon:doctor` (NAV-03) Summary

`/arcanon:doctor` ships — an 8-check diagnostic suite that verifies an Arcanon
installation is healthy. Per-check `PASS`/`WARN`/`FAIL`/`SKIP`, structured
exit codes (0 = all pass or only non-critical WARN; 1 = critical fail), and
`--json` output for parity with every other hub.js command. Read-only by
contract — no DB writes, no migrations triggered, no new HTTP routes, no new
auth surface.

## Goal

NAV-03: when something is broken (worker won't start, DB corrupt, MCP
misconfigured, config invalid), operators today have no single command that
pinpoints the failure. `/arcanon:doctor` is that command. It also serves as
the v0.1.4 release-gate smoke (referenced from VER-05). With 114-03 landed,
Phase 114 (read-only navigability commands) is complete: `/arcanon:list` (NAV-01,
114-01), `/arcanon:view` (NAV-02, 114-02), and `/arcanon:doctor` (NAV-03, 114-03)
all ship.

## Truths Validated

| Truth | How |
| ----- | --- |
| `/arcanon:doctor` in a healthy project prints PASS for the critical checks (1, 5, 6) and exits 0 | Tests 1, 2 in `tests/doctor.bats`. Test 1 asserts 8 numbered check lines + summary; Test 2 asserts the JSON shape with id/name/status/detail per check + critical checks PASS. |
| Critical FAIL → exit 1 | Test 4 (chmod -w `$ARCANON_DATA_DIR` to break check 5 → exit 1) and Test 5b/6 (worker unreachable → check 1 FAIL → exit 1). |
| Non-critical FAIL → WARN, exit 0 | Test 7 (schema 14 < head 16 → check 3 WARN, exit 0), Test 10 (hub unreachable → check 8 WARN, exit 0), Test 11 (linked-repo missing → check 4 WARN, exit 0). |
| Migration head from filesystem glob, NOT a constant | Verified by Test 7 (works with the current head 16) and by inspecting hub.js:935-947 — `fs.readdirSync` + regex + `Math.max`. After Phase 117 lands `017_scan_overrides.js` the head becomes 17 with no source change required. |
| MCP smoke = liveness probe (Option B) | Test 8 — spawns the real `worker/mcp/server.js` and verifies the process stays alive past 1s without crashing on import. Does NOT send `tools/list`, does NOT implement the handshake. |
| Hub credential check SKIPs cleanly when no creds | Test 5 — empty `$HOME/.arcanon/config.json`, no env vars → check 8 SKIP, overall exit 0. |
| `--json` emits a single object with `summary.exit_code` | Test 2 — round-trips through `jq -e` for shape + summary fields. |
| Silent in non-Arcanon directory | Test 3 — empty stdout, exit 0 from a fresh tmpdir. |
| Worker-unreachable FAIL path covered (FLAG 7) | Test 6 (= Test 5b in plan) — bypasses the markdown wrapper to skip auto-start; check 1 FAIL with detail starting `worker unreachable:`, exit 1. |

## Artifacts Created

- **`plugins/arcanon/commands/doctor.md`** (~70 lines). Frontmatter
  (`description`, `argument-hint: "[--json]"`, `allowed-tools: Bash`) + body
  with usage table, read-only guarantee block, an auto-start bash wrapper that
  sources `lib/worker-client.sh`, gates on `_arcanon_is_project_dir`, starts
  the worker if needed, then exec's `bash hub.sh doctor $ARGUMENTS`. Includes
  a `## Help` section with per-check failure recovery hints.
- **`plugins/arcanon/worker/cli/hub.js cmdDoctor`** — full 8-check
  implementation. Registered in `HANDLERS` at hub.js:1041 as
  `doctor: cmdDoctor`. ~210 lines including the per-check timeout-guarded
  callbacks.
- **`plugins/arcanon/worker/cli/hub.js fetchWithTimeout`** — module-private
  helper at hub.js:87. Bounded fetch returning
  `{ok,status,json,elapsedMs,error}`. Used by checks 1, 2, 8.
- **`plugins/arcanon/worker/cli/hub.js runCheck`** — module-private helper
  at hub.js:811. 2-second per-check timeout + exception-to-FAIL/WARN
  conversion. Returns the canonical `{id,name,criticality,status,detail}`
  row shape.
- **`plugins/arcanon/worker/cli/hub.js formatDoctorTable`** — module-private
  helper at hub.js:840. Pretty-printer for human mode (`N. STATUS  name detail`
  aligned + summary line).
- **`plugins/arcanon/tests/fixtures/doctor/seed.sh`** — delegates to the
  existing `list-fixture` seeder; adds optional `--no-scan` and
  `--schema-version <N>` flags. The schema-downgrade flag uses the sqlite3
  CLI to delete `schema_versions` rows above N (Test 7 needs head=14 against
  filesystem head=16).
- **`plugins/arcanon/tests/fixtures/doctor/mock-hub.js`** — 17-line node
  http server on 127.0.0.1:37996 returning `200 {"version":"x"}` for
  `/api/version`, 404 otherwise. Used by Test 9 to verify check 8's success
  path without depending on `app.arcanon.dev` reachability.
- **`tests/doctor.bats`** — 12 bats E2E tests at the repo root (matches
  `tests/list.bats`, `tests/verify.bats`). Includes the per-test HOME
  isolation needed because `resolveCredentials()` reads `os.homedir()`,
  not `$ARCANON_DATA_DIR`.

## Files Modified

| File | Change | Reason |
| ---- | ------ | ------ |
| `plugins/arcanon/worker/cli/hub.js` | +`fetchWithTimeout` (~25 lines), +`runCheck` (~25 lines), +`formatDoctorTable` (~20 lines), +`cmdDoctor` (~210 lines), +`doctor: cmdDoctor` in HANDLERS, +`import { spawn } from 'node:child_process'`, +`import Database from 'better-sqlite3'` | NAV-03 handler. |
| `tests/commands-surface.bats` | Iteration list extended `list view` → `list view doctor` (was 11 commands, now 12); +2 NAV-03 `@test` blocks (frontmatter regression + handler dispatch positive-assertion) | NIT 8 + the standard NAV-03 surface contract. |
| `plugins/arcanon/CHANGELOG.md` | `### Added` line under `[Unreleased]` for `/arcanon:doctor` (8-line entry covering disposition matrix + key design decisions) | Keep-a-Changelog discipline. No version pin (Phase 122 cuts v0.1.4). |

## Tests Added

| # | Test | Asserts |
| --- | ---- | ------- |
| 1 | doctor all-pass scenario emits 8 check lines and exits 0 | `count = 8` lines matching `^\s*\d+\.\s+(PASS\|WARN\|FAIL\|SKIP)`; header + summary present; exit 0. |
| 2 | doctor --json emits structured object with 8 checks | `jq -e '.summary.exit_code == 0'`, `(.checks \| length) == 8`, per-check shape, critical checks (1, 5, 6) PASS. |
| 3 | silent in non-Arcanon directory | empty stdout, exit 0 from a fresh tmpdir. |
| 4 | exits 1 when critical check 5 (data dir) FAILs | chmod -w `$ARCANON_DATA_DIR`, then check 5 line says FAIL + summary says exit 1. |
| 5 | reports SKIP for check 8 when no credentials | empty `$HOME/.arcanon/config.json`, no env creds → check 8 SKIP, exit 0. |
| 6 | reports check 1 FAIL + exit 1 when worker unreachable (FLAG 7) | seed healthy DB, do NOT start worker, call hub.sh directly → check 1 detail starts with `worker unreachable:`, exit 1. |
| 7 | commands/doctor.md exists with frontmatter | file exists, has description/allowed-tools, declares Bash. |
| 8 | reports WARN for check 3 when DB schema lags migration head | seed with `--schema-version 14`; check 3 detail starts `db schema 14 < migration head `; exit 0. |
| 9 | reports check 7 PASS for MCP liveness probe | spawn the real MCP server; check 7 PASS with detail starting `mcp server alive in `. |
| 10 | reports check 8 PASS when hub round-trip succeeds | spawn `mock-hub.js` on port 37996, write creds + `hub_url`, run doctor → check 8 PASS, detail mentions the URL. |
| 11 | reports check 8 WARN when hub unreachable | seed creds + `hub_url=http://127.0.0.1:1` → check 8 WARN, exit 0. |
| 12 | reports check 4 WARN when a linked-repo dir is missing | config with 4 linked repos, 1 phantom path → check 4 WARN, detail mentions the missing path. |

Plus 2 new tests in `tests/commands-surface.bats`:
- `NAV-03: /arcanon:doctor declares allowed-tools: Bash`
- `NAV-03: worker/cli/hub.js registers doctor: cmdDoctor` (positive
  counterpart to NAV-02's negative `! grep -q view: cmdView` regression)

`bats tests/doctor.bats tests/commands-surface.bats tests/list.bats` →
26/26 green. Full `bats tests/` → 339/340 (sole failure is pre-existing
macOS `HOK-06` p99 latency, documented in STATE.md, not introduced here).

## Decisions

1. **Option B / liveness probe for check 7** (FLAG 5). Spawn the MCP server,
   wait up to 1 second, treat "still alive at deadline" OR "JSON-RPC line on
   stdout" as PASS. Smoke test, not conformance — covers the actual operator
   pain point (import-time crashes from missing deps, bad require paths,
   syntax errors). Full handshake (Option A) would have been ~3× the code
   for marginal additional coverage and is left to a future MCP-conformance
   plan.

2. **Filesystem glob for migration head** (RESEARCH §7 Q2). `fs.readdirSync`
   on `worker/db/migrations/`, regex-filter `^[0-9]+_.*\.js$`, parse the
   numeric prefix, take the max. After Phase 117 adds `017_scan_overrides.js`
   the head becomes 17 with no source change. The alternative (a hardcoded
   `MIGRATION_HEAD = 16` constant) is brittle by construction and adds a
   maintenance task to every future migration plan.

3. **Fresh isolated read-only Database connection for checks 3 and 6**
   (BLOCK 2). The worker's `openDb()` is a process-cached singleton that
   (a) auto-runs migrations on first open and (b) is consumed by every
   worker request. Calling `db.close()` on it from the doctor would break
   subsequent worker queries; running migrations from a diagnostic command
   would violate the read-only contract. The fix is two lines:
   `new Database(dbPath, { readonly: true, fileMustExist: true })` wrapped
   in `try { ... } finally { db.close(); }`.

4. **`fetchWithTimeout` helper with documented contract**. `{ ok, status,
   json, elapsedMs, error }` — exactly the fields the three consuming
   checks (1, 2, 8) read. Eliminates try/catch boilerplate at three sites
   and makes the call sites read like declarative checks rather than
   error-handling exercises.

5. **`--json` flag for parity** (RESEARCH §7 Q5). Every other hub.js
   command honors `--json`; the doctor inherits via the existing `emit()`
   helper. Enables CI / pre-release-gate integration without text-parsing.

6. **8 checks, not 7** (matches REQUIREMENTS.md NAV-03; ROADMAP intro
   prose says "7-check" — see Discrepancies). The 8th check (hub
   credentials round-trip) is a real operational concern for any operator
   using the SaaS hub, even if "no creds configured" is a SKIP rather than
   a failure.

7. **Markdown wrapper auto-starts the worker** (matches `/arcanon:list`
   and `/arcanon:view`). Operators running `/arcanon:doctor` from a clean
   shell get the auto-launch UX they expect from every other command.

8. **Test 6 (worker-unreachable, plan's "5b") bypasses the markdown
   wrapper** (FLAG 7). The wrapper would auto-start the worker and
   prevent the failure path from firing. The test calls `bash hub.sh
   doctor` directly to hit the real check 1 FAIL path.

9. **Per-test `HOME` isolation in `tests/doctor.bats`**. `resolveCredentials()`
   reads `os.homedir()/.arcanon/config.json`, NOT `$ARCANON_DATA_DIR`. Without
   per-test HOME isolation the user's real `~/.arcanon` would leak into the
   test environment and Tests 5/9/10 would behave non-deterministically
   based on whether the developer is logged into the hub.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] MCP liveness probe contract was internally inconsistent**

- **Found during:** Task 2, implementing check 7 + Test 8.
- **Issue:** The plan template specified Option B as "PASS only on first
  JSON-RPC line on stdout within 1s, else WARN". But the
  `@modelcontextprotocol/sdk` stdio transport is silent until a client
  request arrives — the server emits NOTHING on stdout during clean
  startup. With the literal contract, every healthy MCP server would
  WARN, and Test 8's "expect PASS" assertion would fail unconditionally.
- **Fix:** Augmented the PASS contract: `(JSON-RPC line within 1s) OR
  (process still alive at the 1s deadline)`. Survival to the deadline
  proves the server reached its stdio-read loop without crashing on
  import — which is exactly the failure mode FLAG 5 says we care about
  ("most MCP-server breakage in practice is import-time"). The intent
  of FLAG 5 is preserved; only the specific signal expanded.
- **Files modified:** `plugins/arcanon/worker/cli/hub.js` (check 7
  body), tracked inline in the commit message.
- **Commit:** `d730a4a`.

**2. [Rule 1 — Bug] Plan template field-name typo for `resolveCredentials()`
return shape**

- **Found during:** Task 2, implementing check 8.
- **Issue:** Plan template's example used `creds.api_key` and
  `creds.hub_url` (snake_case). Inspection of
  `plugins/arcanon/worker/hub-sync/auth.js:58-100` shows
  `resolveCredentials()` returns `{ apiKey, hubUrl, source }` (camelCase).
  Implementing the template literally would have produced `undefined` for
  both fields and an `Authorization: Bearer undefined` header.
- **Fix:** Used the actual return-shape field names in cmdDoctor's
  check 8.
- **Files modified:** `plugins/arcanon/worker/cli/hub.js` (check 8
  body).
- **Commit:** `d730a4a`.

### Non-deviations (worth flagging)

- **Per-test `HOME` isolation in `tests/doctor.bats`** is NOT a deviation —
  the plan template's Test 9 setup said "use `ARCANON_DATA_DIR` override
  so this is per-test-tmpdir, not the user's real `$HOME`". But
  `resolveCredentials` reads `os.homedir()`, NOT `$ARCANON_DATA_DIR`.
  The plan author noted the per-tmpdir requirement but used the wrong
  env var to achieve it. We honored the requirement using the right
  env var (`HOME`).

## Discrepancies

**ROADMAP intro prose says "7-check doctor" but REQUIREMENTS.md NAV-03
enumerates 8 checks** (numbered 1-8). This plan ships 8 checks, matching
REQUIREMENTS.md (the more authoritative source). Surfaced for Phase 122
documentation reconciliation: either (a) update ROADMAP.md prose to say
"8-check" or (b) accept the prose discrepancy and add a clarifying
footnote.

The `<background>` block of `114-03-PLAN.md` already flagged this
("This plan ships 8 checks. Surface the prose discrepancy in SUMMARY.md
for Phase 122 doc reconciliation.") — formal trigger now placed in the
SUMMARY.

## Open Items

- Phase 122 (verification gate / docs reconciliation) needs to update
  the ROADMAP intro prose from "7-check" to "8-check" for `/arcanon:doctor`.
- A future MCP-conformance plan can add tools/list-handshake validation
  if an operator pain point materializes (pre-flight FLAG 5 explicitly
  scoped this out of NAV-03).
- The README quick-start table (referenced in RESEARCH §7 Q6) was not
  updated by this plan — Phase 122 owns the README pass for v0.1.4 cut.

Cross-plan handoff for downstream consumers:

- VER-05 (release-gate verification) can cite `/arcanon:doctor --json` +
  `jq -e '.summary.exit_code == 0'` as the v0.1.4 release gate.
- Future doctor-extension work (e.g. a check 9 for plugin-version cache
  freshness) follows the established `runCheck(N, name, criticality, fn)`
  + `checks.push(...)` pattern; no architectural change required.

## Threat Flags

None. The threat model in `114-03-PLAN.md` (T-114-03-01 through
T-114-03-09) was honored as written — no new surface beyond what the
threat register accepted/mitigated. Specifically:

- **T-114-03-09 mitigation verified:** `new Database(dbPath, { readonly:
  true, fileMustExist: true })` is the actual call in checks 3 and 6.
  `db.close()` runs in `finally`. `openDb()` is NEVER called from
  `cmdDoctor`. Audited at hub.js:973 (check 6) and hub.js:961-963 (check 3).
- **T-114-03-05 mitigation verified:** the bearer token is only ever
  passed to `fetchWithTimeout` as an `Authorization` header value; the
  WARN detail strings (`hub auth rejected: 401`, `hub unreachable:
  ECONNREFUSED`) never interpolate the token.
- **T-114-03-03 mitigation verified:** `spawn(process.execPath,
  [serverPath], ...)` uses an arg array (no shell), and `serverPath`
  is computed from `path.join(__dirname, "..", "mcp", "server.js")` (no
  user input).

## Self-Check: PASSED

- All 4 created files present on disk:
  - `plugins/arcanon/commands/doctor.md` — FOUND
  - `plugins/arcanon/tests/fixtures/doctor/seed.sh` — FOUND
  - `plugins/arcanon/tests/fixtures/doctor/mock-hub.js` — FOUND
  - `tests/doctor.bats` — FOUND
- Both task commits present in `git log --oneline --all`:
  - `86b9d4f` (Task 1: scaffold + 5 trivial-to-compose checks)
  - `d730a4a` (Task 2: implement checks 3/4/7/8 + mock-hub)
- Key code landmarks verified:
  - `import { spawn } from "node:child_process"` in hub.js
  - `import Database from "better-sqlite3"` in hub.js
  - `async function fetchWithTimeout` in hub.js
  - `async function cmdDoctor` in hub.js
  - `doctor: cmdDoctor, // NAV-03` in HANDLERS map
  - `_arcanon_is_project_dir` sourced in `commands/doctor.md`
  - `worker-start.sh` referenced in `commands/doctor.md` (auto-start)
- `bats tests/doctor.bats tests/commands-surface.bats tests/list.bats` →
  26/26 green.
- `bats tests/` → 339/340 (sole failure is pre-existing macOS HOK-06
  platform constraint, not introduced by this plan).
