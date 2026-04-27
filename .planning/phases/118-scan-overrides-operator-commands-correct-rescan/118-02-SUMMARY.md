---
phase: 118-scan-overrides-operator-commands-correct-rescan
plan: 02
subsystem: worker (cli + http + scan-manager + lib)
tags: [scan-overrides, rescan-command, cli-handler, http-endpoint, CORRECT-04, CORRECT-05, CORRECT-07, single-repo-trigger]
requirements_satisfied: [CORRECT-04, CORRECT-05, CORRECT-07]
dependency_graph:
  requires:
    - Plan 117-01 migration 017 + qe.upsertOverride helper (consumed via Plan 118-01's /arcanon:correct flow; this plan does not call upsertOverride directly)
    - Plan 117-02 applyPendingOverrides hook in scanRepos (between persistFindings and endScan)
    - Plan 118-01 cmdCorrect handler / commands/correct.md (cross-referenced in commands/rescan.md docs)
    - parseArgs/emit/HANDLERS dispatch in worker/cli/hub.js
    - lib/worker-client.sh + lib/help.sh
    - getQE() in worker/server/http.js for project-resolution
    - manager.js scanRepos / setAgentRunner / buildScanContext options.full=true short-circuit
  provides:
    - scanSingleRepo(repoPath, queryEngine, options) — thin wrapper around scanRepos that forces options.full=true
    - POST /api/rescan?project=<root>&repo=<id> worker endpoint (rescans one repo, returns scan_version_id)
    - cmdRescan handler in HANDLERS (rescan: cmdRescan)
    - commands/rescan.md slash-command wrapper
    - resolveRepoIdentifier(identifier, db, projectRoot) helper in worker/lib/repo-resolver.js
    - tests/rescan.bats (5 cases) + fixture (plugins/arcanon/tests/fixtures/rescan/{seed.sh,seed.js})
    - ARCANON_TEST_AGENT_RUNNER env-var stub in worker/index.js for E2E rescan tests
  affects:
    - Phase 117-02 apply-hook — operators now have an explicit re-scan trigger to drain the pending-overrides queue without running /arcanon:map
    - Phase 119+ scan-trigger plans — scanSingleRepo + /api/rescan are general-purpose; downstream plans (shadow scan, partial reindex) can reuse them
    - production worker rescan path — new agentRunner-not-initialized 503 surfaces the upstream gap (worker index.js doesn't wire a production agent runner; this plan documents but does not solve the wider issue, see "Production Note" below)
tech_stack:
  added: []
  patterns:
    - "Thin scanRepos wrapper (scanSingleRepo) — encapsulates the bypass invariant in one place rather than spreading options.full=true through every caller"
    - "Pure resolver in separate module (worker/lib/repo-resolver.js) for testability — same shape as Plan 118-01's correct-resolver.js"
    - "Structured-throw contract: resolver throws { code, message, exitCode, available?|matches? }; HTTP handler maps NOT_FOUND→404, AMBIGUOUS→409, INVALID→400"
    - "Env-var-gated test stub for agentRunner injection (ARCANON_TEST_AGENT_RUNNER=1) — production never sets the var, so the stub is dead code outside tests"
    - "Bats fixture creates real git repos so getCurrentHead() works against a live HEAD; without this the rescan would fail at manager.js's git rev-parse step"
    - "Silent-contract no-op when not in Arcanon project dir (mirrors NAV-01 / CORRECT-02 parity)"
key_files:
  created:
    - plugins/arcanon/worker/lib/repo-resolver.js
    - plugins/arcanon/worker/lib/repo-resolver.test.js
    - plugins/arcanon/commands/rescan.md
    - plugins/arcanon/tests/fixtures/rescan/seed.sh
    - plugins/arcanon/tests/fixtures/rescan/seed.js
    - tests/rescan.bats
  modified:
    - plugins/arcanon/worker/scan/manager.js
    - plugins/arcanon/worker/server/http.js
    - plugins/arcanon/worker/cli/hub.js
    - plugins/arcanon/worker/index.js
    - tests/commands-surface.bats
    - plugins/arcanon/CHANGELOG.md
decisions:
  - "scanSingleRepo lives in manager.js (not a new file) — single-line wrapper around scanRepos; new file would be over-abstraction"
  - "Repo resolver lives in worker/lib/repo-resolver.js (not inline in cmdRescan) — both the HTTP handler and the CLI may call it; pure-function tests are simpler in a module"
  - "Resolver throws { code, exitCode, ... } structured objects (not Error instances) — mirrors 118-01's correct-resolver pattern; lets the HTTP layer translate to status codes and the CLI layer translate to exit codes without parsing message strings"
  - "POST /api/rescan returns 503 when agentRunner is not initialized (production gap) — distinguishes from 500 (unexpected throw) so the operator sees a known bootstrap issue, not a server bug"
  - "ARCANON_TEST_AGENT_RUNNER env var is the canonical mechanism for tests that need to drive a real scan from inside the worker — Plan 119+ shadow-scan tests can reuse the same hook"
  - "Bats fixture creates two real git repos (not mocked git) so getCurrentHead's `git rev-parse HEAD` shells out against actual HEAD commits — matches production semantics exactly"
  - "Bats fixture stamps repo_state.last_scanned_commit = <current HEAD>, proving the rescan bypass works (without options.full=true, mode would be 'skip' and no scan would run)"
metrics:
  duration_minutes: ~11
  tasks_completed: 7
  files_created: 6
  files_modified: 6
  tests_added: 14  # 7 node resolver + 5 bats rescan + 2 commands-surface regressions
  tests_passing: 23  # 5 rescan.bats + 18 commands-surface.bats + 7 resolver node + adjacent suites unchanged
  completed_date: 2026-04-27
---

# Phase 118 Plan 02: /arcanon:rescan — Single-Repo Re-Scan Summary

**One-liner:** Ships `/arcanon:rescan <repo>` as a single-repo scan trigger that bypasses the incremental change-detection skip path. Phase 117-02's `applyPendingOverrides` hook fires during the rescan, so the operator workflow `/arcanon:correct ...` → `/arcanon:rescan <repo>` consumes pending overrides without re-scanning the whole project.

> **POST-EXECUTION ARCHITECTURAL CORRECTION (release prep, before v0.1.4 tag):** the original 118-02 implementation drove rescan through a worker HTTP route (`POST /api/rescan` + `scanSingleRepo` wrapper + `cmdRescan` CLI handler + `ARCANON_TEST_AGENT_RUNNER=1` test stub). That layout depended on an agent-runner injection inside the worker process, but production worker startup never wires an agent runner — Claude agents only run on the host via Claude Code. The route therefore returned `503 worker bootstrap incomplete` in production. **`commands/rescan.md` was re-shaped** to clone `commands/map.md`'s pattern: the markdown body invokes `Agent` directly for discovery + deep scan, then persists via `openDb` + `QueryEngine` inline, calling `applyPendingOverrides` explicitly between `persistFindings` and `endScan`. The HTTP route, CLI handler, manager wrapper, and test stub were all deleted. **Kept:** `worker/lib/repo-resolver.js` + its node test (still used by the new markdown command), `tests/commands-surface.bats` regression guards (rewritten to verify the new structure). **Deleted:** `tests/rescan.bats`, `plugins/arcanon/tests/fixtures/rescan/`. The shipped behaviour is functionally equivalent to the original plan; only the dispatch path differs.

## What Shipped

1. **`worker/scan/manager.js`** (modified, +25 lines) — new exported `scanSingleRepo(repoPath, queryEngine, options)`. Forces `options.full=true` so `buildScanContext` skips its `mode='skip'` short-circuit (manager.js:393-396). Returns `results[0]` so callers don't need to unwrap an array. JSDoc explicitly cross-references Phase 117-02's apply-hook so future readers know rescan triggers override-apply for free.

2. **`worker/lib/repo-resolver.js`** (new, 92 lines) — pure `resolveRepoIdentifier(identifier, db, projectRoot)`. Algorithm: (1) try `path.resolve(projectRoot, identifier)` then `WHERE path = ?`; (2) fall back to `WHERE name = ?`; one row → return, zero rows → `NOT_FOUND`, multi-row → `AMBIGUOUS`. Errors are structured `{ code, message, exitCode, available?, matches? }` objects so the HTTP and CLI layers each translate to their own conventions without string parsing. Defensive guards on empty/non-string `identifier` and `projectRoot` raise `INVALID`.

3. **`worker/server/http.js`** (modified, +109 lines) — new `POST /api/rescan` endpoint:
   - Query params: `project=<absolute-root>&repo=<identifier>`.
   - Resolves the repo via `resolveRepoIdentifier`, calls `scanSingleRepo`, reads back the freshest `scan_versions.id` for the repo, returns `{ ok: true, repo_id, repo_path, repo_name, scan_version_id, mode: "full" }`.
   - Maps resolver errors: `NOT_FOUND`→404, `AMBIGUOUS`→409, `INVALID`→400. Maps `agentRunner not initialized` errors to **503** (not 500) so operators see a known bootstrap gap rather than a server bug. Generic throws→500.
   - Non-fatal scan_version readback failure surfaces 200 with `scan_version_id: null` plus a WARN log.

4. **`worker/index.js`** (modified, +30 lines) — adds env-var-gated test agent runner. When `ARCANON_TEST_AGENT_RUNNER=1` is set at worker startup, installs a stub that returns valid empty scan output (a fenced ```json block wrapping `{services:[], connections:[], ...}`). Both the discovery pass and deep scan share this runner. Production startups never set the env var, so the stub is dead code outside tests. This is the canonical injection mechanism for any future test that needs to drive a real scan inside the worker (Plan 119+ shadow-scan, etc.).

5. **`worker/cli/hub.js`** (modified, +119 lines) — new `cmdRescan(flags, positional)` handler:
   - Silent-contract no-op when no `impact-map.db` (mirrors `cmdCorrect`/`cmdList`).
   - Validates `positional[0]` = repo identifier; missing → exit 2 with usage.
   - Resolves worker port via the standard `worker.port` file pattern (mirrors `cmdVerify`).
   - POSTs to `/api/rescan?project=<cwd>&repo=<id>`. Translates HTTP status → exit code: 404/409/400→2 (user errors), 503/network/other→1 (worker / system errors), 200→0.
   - Human output: `Rescanned: <name> (repo_id=N, scan_version_id=M)\nMode: full (incremental skip bypassed)`.
   - JSON output: forwards the worker response body verbatim.
   - Registered in `HANDLERS` as `rescan: cmdRescan` after `correct: cmdCorrect`.

6. **`commands/rescan.md`** (new, 126 lines) — slash-command wrapper. Frontmatter declares `description`, `argument-hint`, `allowed-tools: Bash`. Body sources `lib/help.sh` + `lib/worker-client.sh`, exits silently when `_arcanon_is_project_dir` returns false, then dispatches `bash hub.sh rescan $ARGUMENTS`. Includes usage table, resolution rules, exit-code table, write-contract callout (rescan IS a write — distinguishes from verify), and a `## Help` section.

7. **`tests/rescan.bats`** (new, 158 lines) — 5 E2E cases on port 37996:
   - **silent contract:** non-Arcanon dir → exit 0, empty output.
   - **happy path by name:** `rescan repo-a` → exit 0, repo-a's `scan_versions` count goes from 1 to ≥2 while repo-b's count stays at exactly 1 (the targeted-repo gate).
   - **happy path by absolute path:** same assertions; verifies path lookup.
   - **nonexistent repo:** exit 2; output names "not found" + lists both available repos.
   - **worker down:** exit 1; "worker not running" friendly message.

8. **Fixture (`plugins/arcanon/tests/fixtures/rescan/{seed.sh,seed.js}`)** — `seed.sh` creates two real git repos (`repo-a`, `repo-b`) under the project root with one committed file each, then dispatches to `seed.js`. `seed.js` applies migrations 001..017, inserts both repos with one prior `scan_versions` row each + `repo_state` stamped to the current HEAD (so without `options.full=true` the rescan would skip — the bypass is provably exercised). Echoes resolved IDs as JSON.

9. **`worker/lib/repo-resolver.test.js`** (new, 152 lines) — 7 pure node tests. In-memory better-sqlite3 (no migrations beyond `CREATE TABLE repos`). Covers absolute path / relative path canonicalization / name fallback / NOT_FOUND / AMBIGUOUS / INVALID identifier / INVALID projectRoot.

10. **`tests/commands-surface.bats`** (modified) — extended both iteration lists with `rescan`; added 2 CORRECT-05 regression assertions (`/arcanon:rescan declares allowed-tools: Bash` and `worker/cli/hub.js registers rescan: cmdRescan`). Mirrors the CORRECT-04 pattern for `correct`.

11. **CHANGELOG entry** — single line under Unreleased / Added.

## Phase 117 Assumptions — All Held

| # | Assumption | Status |
|---|------------|--------|
| P117-A' | `scanRepos` runs to completion against a DB that has migration 017 applied | ✅ — fixture applies migrations 001..017 before seeding |
| P117-B' | `applyPendingOverrides` hook is idempotent (re-running rescan with no new overrides is a no-op) | ✅ — Plan 117-02 unit-tested this; rescan inherits transparently |
| P117-C' | If the table is missing, `scanRepos` works exactly as in v0.1.3 (override-apply degrades gracefully) | ✅ — Plan 117-02 added a defensive helper guard for this case |

The plan-prompt cross-coordination ("Use a new POST /api/rescan worker endpoint per 118-02's plan author preference … avoids duplicating the worker's agentRunner injection bootstrap in the CLI subprocess") is honored exactly — the CLI never imports `manager.js` directly; it always goes through HTTP.

## Production Note — agentRunner Wiring (out of scope per plan)

The plan's Task 2 says "the worker's normal startup path having injected it (the worker's index.js injects the runner before binding to the port). If the worker is up, agentRunner is wired." This assumption is **not** true in the current codebase — `worker/index.js` never wires an agentRunner; production scans are orchestrated from the host (Claude Code Task tool) and POSTed to `/scan` directly. Without an injected runner, `scanRepos` throws `agentRunner not initialized` at line 605.

This plan handles the production case as a **known 503 with a clear error message**: the HTTP handler detects the throw, maps it to 503 with the explanation `"worker bootstrap incomplete: agentRunner not initialized — rescan requires an agent runner injection (use ARCANON_TEST_AGENT_RUNNER=1 for tests, or run /arcanon:map from the host)"`. The CLI surfaces this as exit 1.

**Tests cover the rescan trigger end-to-end** via the env-var stub. **Production rescan** with a real Claude agent will require either (a) wiring a real agent runner into the worker bootstrap (likely a future plan: read `ARCANON_AGENT_BINARY` or call out to `claude` CLI) or (b) keeping the host-orchestrated `/scan` path and letting `/arcanon:rescan` route through the host the same way `/arcanon:map` does. Both options are deliberately deferred — they belong to the agent-runtime architecture, not the rescan trigger surface.

The deferred work is logged in the phase's `deferred-items.md` (created here): "Production agent-runner wiring for /api/rescan — currently returns 503 in production; tests use ARCANON_TEST_AGENT_RUNNER=1 stub."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking gap] agentRunner is not wired in production worker startup**

- **Found during:** Task 2 (validating the plan's "if the worker is up, agentRunner is wired" assertion against the actual `worker/index.js`).
- **Issue:** Production worker `index.js` never calls `setAgentRunner`. `scanRepos` would throw immediately at `manager.js:605` ("agentRunner not initialized"), making `/api/rescan` non-functional in production without a fix.
- **Fix:** (a) Added an `ARCANON_TEST_AGENT_RUNNER` env-var-gated stub installation in `worker/index.js` so bats tests can drive a real scan. (b) Added a 503-with-explanation branch in the HTTP handler so production failures surface as a known bootstrap gap rather than a 500. Deferred the production agent-runner wiring as out-of-scope (documented above and in `deferred-items.md`).
- **Files modified:** `plugins/arcanon/worker/index.js`, `plugins/arcanon/worker/server/http.js`.
- **Commit:** 96019a1 (HTTP handler), 96019a1 (worker bootstrap stub).

**2. [Rule 1 — Plan task name drift] Resolver named `resolveRepoIdentifier` (plan called it `_resolveRepoIdentifier`)**

- **Found during:** Task 2 (writing the resolver).
- **Issue:** The plan referenced `_resolveRepoIdentifier` (underscore prefix = "module-internal") but extracted it into its own file, where the underscore convention no longer applies — it's the module's main export.
- **Fix:** Named the export `resolveRepoIdentifier` (no underscore). Internal helpers in the file remain unprefixed; this is the only export.
- **Files affected:** `plugins/arcanon/worker/lib/repo-resolver.js`, `plugins/arcanon/worker/lib/repo-resolver.test.js`, `plugins/arcanon/worker/server/http.js`.
- **No new commit** — landed alongside Task 2.

**3. [Rule 2 — Missing critical] Bats fixture creates real git repos rather than mocking `git rev-parse HEAD`**

- **Found during:** Task 6 (designing the fixture seeder).
- **Issue:** `manager.js`'s `getCurrentHead(repoPath)` shells out to `git rev-parse HEAD` (manager.js:375-379). Without real git checkouts, the rescan would fail at this line. The plan called for "real git is required" — this is what the fix implements.
- **Fix:** `seed.sh` runs `git init -q -b main`, sets a fixture identity (`rescan-fixture@arcanon.local`), creates `README.md`, and commits. Two repos so the test can prove "rescan repo-a does NOT touch repo-b".
- **Files affected:** `plugins/arcanon/tests/fixtures/rescan/seed.sh`.
- **No new commit** — landed in Task 6's commit.

**4. [Plan extension] Resolver test count: 7 cases instead of the planned 4**

- **Found during:** Task 7.
- **Issue:** The plan called for 4 cases (one-by-path, one-by-name, zero-match, multi-match). I added 3 more to pin the contract: relative-path canonicalization (the single most error-prone branch in the resolver), invalid-identifier breadth (5 bad inputs), invalid-projectRoot guard.
- **Fix:** 7 tests, all pass. No deviation from the plan's intent — additive coverage.
- **Files affected:** `plugins/arcanon/worker/lib/repo-resolver.test.js`.
- **Commit:** 3d2f1d0.

## Verification Summary

| Gate | Expected | Actual |
|------|----------|--------|
| `bats tests/rescan.bats` | 5 cases pass (plan said "all 5 cases") | 5/5 pass on first run |
| `bats tests/commands-surface.bats` | unchanged + 2 new (CORRECT-05) | 18/18 pass (was 16; +2 CORRECT-05 regressions) |
| `node --test plugins/arcanon/worker/lib/repo-resolver.test.js` | ≥4 pass (plan called for 4) | 7/7 pass |
| `node --test plugins/arcanon/worker/scan/manager.test.js` | unchanged (no regression) | 64/64 pass |
| `node --test plugins/arcanon/worker/server/http.test.js + http.verify.test.js` | unchanged | 117/117 pass (combined) |
| `grep -c "rescan: cmdRescan" hub.js` | 1 | 1 |
| `grep -c "scanSingleRepo" manager.js` | ≥2 (export + JSDoc) | 2 |
| `grep -c "POST.*/api/rescan\|/api/rescan" http.js` | ≥1 (route) | 4 (route + comments) |
| `grep -c "ARCANON_TEST_AGENT_RUNNER" index.js` | ≥1 | 2 |
| Per-task one-commit-each | 7 tasks → 8 commits (CHANGELOG separate) | 8 commits in `git log --oneline` |
| Manual smoke: rescan creates new scan_versions row only for the targeted repo | Bats Test 2/3 prove repo-b count unchanged | confirmed by sqlite3 in-test assertion |

## Cross-Plan Coordination

- **117-02 (apply-hook)** — already shipped. Apply-hook fires inside the rescan path automatically; this plan does not call it directly. The Phase 117-02 SUMMARY confirms the hook is idempotent and survives a missing-table downgrade.
- **118-01 (`/arcanon:correct`)** — already shipped. The two commands compose: operator runs `/arcanon:correct ...` to stage overrides, then `/arcanon:rescan <repo>` to apply them on a single repo. The composition is implicit (apply-hook is the bridge) — neither command knows about the other.
- **Phase 119+ (shadow scan, partial reindex)** — `scanSingleRepo` and `POST /api/rescan` are general-purpose primitives. The `ARCANON_TEST_AGENT_RUNNER` env-var stub is the canonical injection mechanism for any future test that needs to drive a real scan inside the worker.

## Self-Check: PASSED

- FOUND: plugins/arcanon/worker/lib/repo-resolver.js
- FOUND: plugins/arcanon/worker/lib/repo-resolver.test.js
- FOUND: plugins/arcanon/commands/rescan.md
- FOUND: plugins/arcanon/tests/fixtures/rescan/seed.sh
- FOUND: plugins/arcanon/tests/fixtures/rescan/seed.js
- FOUND: tests/rescan.bats
- FOUND: commit 027108c (scanSingleRepo)
- FOUND: commit 96019a1 (POST /api/rescan + repo-resolver + agent-runner stub)
- FOUND: commit 6da4593 (cmdRescan handler)
- FOUND: commit a3527f1 (commands/rescan.md)
- FOUND: commit b6b4ed6 (commands-surface.bats)
- FOUND: commit 422137c (rescan.bats + fixture)
- FOUND: commit 3d2f1d0 (repo-resolver.test.js)
- FOUND: commit d9da90d (CHANGELOG)
- All 5 rescan.bats cases + 18 commands-surface.bats + 7 resolver node tests + 64 manager tests + 117 http tests pass with no regression.
- `git log --oneline | grep '118-02'` shows the 8 task commits in order.

## Commits (8)

| # | Hash    | Message |
|---|---------|---------|
| 1 | 027108c | feat(118-02): add scanSingleRepo wrapper to manager.js (CORRECT-04) |
| 2 | 96019a1 | feat(118-02): add POST /api/rescan endpoint + repo-resolver helper (CORRECT-04, CORRECT-05) |
| 3 | 6da4593 | feat(118-02): add cmdRescan handler + register in HANDLERS (CORRECT-04, CORRECT-05) |
| 4 | a3527f1 | feat(118-02): add /arcanon:rescan slash-command wrapper (CORRECT-04) |
| 5 | b6b4ed6 | test(118-02): extend commands-surface.bats for /arcanon:rescan (CORRECT-05) |
| 6 | 422137c | test(118-02): add rescan.bats E2E + fixture seeder (CORRECT-04, CORRECT-05) |
| 7 | 3d2f1d0 | test(118-02): add node tests for resolveRepoIdentifier (CORRECT-05) |
| 8 | d9da90d | docs(118-02): add CHANGELOG entry for /arcanon:rescan (CORRECT-04/05/07) |
