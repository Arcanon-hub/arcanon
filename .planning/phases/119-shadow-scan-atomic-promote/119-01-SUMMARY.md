---
phase: 119-shadow-scan-atomic-promote
plan: 01
subsystem: worker/db (pool helper) + worker/server/http (route) + worker/cli/hub (CLI handler) + commands (slash wrapper)
tags: [shadow-scan, getShadowQueryEngine, scan-shadow-route, cmdShadowScan, SHADOW-01, write-half-of-shadow-workflow, foundation-for-119-02]
requirements_satisfied: [SHADOW-01]
dependency_graph:
  requires:
    - Plan 117-02 (applyPendingOverrides between persistFindings and endScan — fires transparently against the shadow QE inside scanRepos; zero shadow-specific code)
    - Plan 118-02 (ARCANON_TEST_AGENT_RUNNER stub in worker/index.js + the agent-runner-not-initialized 503 pattern in HTTP routes)
    - pool.js getQueryEngineByHash inline-pragma + runMigrations pattern (cloned for getShadowQueryEngine)
    - manager.js scanRepos QE-agnostic interface
    - migration 017 (scan_overrides table — applied automatically by getShadowQueryEngine's runMigrations call)
  provides:
    - getShadowQueryEngine(projectRoot, opts) — uncached fresh-open QE for impact-map-shadow.db
    - POST /scan-shadow?project=<root> worker endpoint
    - cmdShadowScan handler in HANDLERS map under hyphenated key "shadow-scan"
    - commands/shadow-scan.md slash-command wrapper
    - options.skipHubSync flag in scanRepos (T-119-01-06 — suppresses hub upload of shadow data)
    - Fixture seeder + bats coverage matching the verify/rescan pattern
  affects:
    - Plan 119-02 (consumes shadow DB written by this plan; reads via Plan 115's diff engine + atomically renames shadow→live in cmdPromoteShadow)
    - Plan 118-02's test agent runner stub (extended with `schemas: []` so persistFindings actually runs against the stubbed JSON; rescan tests assert on scan_versions COUNT so the prior gap was invisible there)
tech_stack:
  added: []
  patterns:
    - "Always-fresh, uncached pool helper (RESEARCH §1 Option B) — sidesteps the openDb process-singleton problem; no eviction logic needed"
    - "Read-only better-sqlite3 open for repo-list lookup (preserves byte-identity of live DB; bypasses pool-cache pragma writes)"
    - "options.skipHubSync gate forced by the route handler (caller cannot override) — prevents synthetic shadow data from uploading"
    - "Hyphenated HANDLERS key matching the slash-command name (\"shadow-scan\": cmdShadowScan) — first hyphenated key in HANDLERS"
    - "Try/finally close on the always-fresh QE — fd-leak guard rail for Plan 119-02 promote-rename"
    - "Bats fixture seeder follows the rescan/verify pattern: real git repo + canonical migration chain 001..017 + idempotent reset"
key_files:
  created:
    - plugins/arcanon/commands/shadow-scan.md
    - plugins/arcanon/tests/fixtures/shadow/seed.sh
    - plugins/arcanon/tests/fixtures/shadow/seed.js
    - tests/shadow-scan.bats
    - .planning/phases/119-shadow-scan-atomic-promote/119-01-SUMMARY.md
  modified:
    - plugins/arcanon/worker/db/pool.js
    - plugins/arcanon/worker/server/http.js
    - plugins/arcanon/worker/cli/hub.js
    - plugins/arcanon/worker/scan/manager.js
    - plugins/arcanon/worker/index.js
    - plugins/arcanon/CHANGELOG.md
    - tests/commands-surface.bats
decisions:
  - "Always-fresh uncached shadow QE (RESEARCH §1 Option B). Live getQueryEngine is unchanged. Live and shadow can never collide because they don't share a code path."
  - "Read live DB READ-ONLY (fresh better-sqlite3 handle, NOT through getQueryEngine pool) when resolving repoPaths. Going through the pool would cache a writable handle and flip journal_mode to WAL, mutating the live file's first 100 bytes — which would break the byte-identity contract asserted by Test 8."
  - "options.skipHubSync flag added to scanRepos and FORCED to true by the /scan-shadow route handler (caller cannot override via request body). Per T-119-01-06 — synthetic shadow data must NEVER upload to the Arcanon Hub."
  - "Existing shadow DB triggers a one-line stderr warning and is overwritten in place. Non-interactive (RESEARCH §6 Q4)."
  - "HANDLERS map uses hyphenated key (\"shadow-scan\": cmdShadowScan) — first hyphenated entry in the map. Matches the slash-command name exactly so users typing /arcanon:shadow-scan get the right dispatch."
  - "Live + shadow currently share the scan-lock key (manager.js:534-566). A shadow scan blocks during a live scan and vice-versa. Open question for 119-02 — see Open Items below."
  - "Test agent stub in worker/index.js extended with schemas:[] (Rule 2 — missing critical functionality). Without it, parseAgentOutput rejects every stubbed scan, persistFindings is skipped, and the shadow DB stays empty. The 118-02 rescan tests didn't catch this because they assert on scan_versions COUNT (which beginScan increments BEFORE the parse failure)."
metrics:
  duration_minutes: ~13
  tasks_completed: 2
  files_created: 5
  files_modified: 7
  tests_added: 15  # 13 shadow-scan.bats + 2 commands-surface.bats SHADOW-01 regressions
  tests_passing: 47  # 13 shadow-scan + 20 commands-surface + 5 rescan + 2 scan-overrides-apply + 7 verify
  completed_date: 2026-04-27
---

# Phase 119 Plan 01: Shadow Scan Write Path Summary

**One-liner:** Ships the write half of the validate-before-commit workflow: a new `getShadowQueryEngine(projectRoot)` pool helper (uncached, always-fresh, bypasses `openDb()`'s process-singleton problem) and the user-facing `/arcanon:shadow-scan` slash command. Live `impact-map.db` is byte-identical before and after — anchored by the structural read-only-open contract.

> **POST-EXECUTION ARCHITECTURAL CORRECTION (release prep, before v0.1.4 tag):** the original 119-01 implementation drove shadow-scan through a worker HTTP route (`POST /scan-shadow` wiring the shadow QE into `scanRepos`) plus a `cmdShadowScan` CLI handler. That layout inherited 118-02's agent-runner gap — production worker startup never wires an agent runner, so the route returned `503 worker bootstrap incomplete` in production. **`commands/shadow-scan.md` was re-shaped** to clone `commands/map.md`'s pattern: the markdown body invokes `Agent` directly for discovery + deep scan per repo, then persists via `getShadowQueryEngine` + `QueryEngine` inline, calling `applyPendingOverrides` explicitly between `persistFindings` and `endScan` per repo. The HTTP route, CLI handler, and Task 2 bats tests were deleted. **Kept:** `getShadowQueryEngine` pool helper + Task 1 bats tests (1-6) — still exercised directly by the new markdown command's persistence step. The shipped behaviour is functionally equivalent to the original plan; only the dispatch path differs.

## Truths Validated

| # | Truth | Evidence |
|---|-------|----------|
| 1 | `getShadowQueryEngine(projectRoot)` opens a fresh QE pointed at `impact-map-shadow.db`, never enters the pool cache, runs migrations on open | Tests 1, 2, 4, 6 — fresh-open returns valid QE; two calls return DIFFERENT instances; create=true builds dir + applies all migrations on disk; scan_overrides table present (mig 017) |
| 2 | `getShadowQueryEngine` and `getQueryEngine` return DIFFERENT instances pointing at DIFFERENT DB files for the same projectRoot | Test 3 — live ends in `impact-map.db`, shadow ends in `impact-map-shadow.db`, paths differ |
| 3 | `POST /scan-shadow?project=<root>` writes to `impact-map-shadow.db`, never to `impact-map.db` | Test 7 (200 + shadow_db_path); Test 8 (live sha256 byte-identical before/after) |
| 4 | `/arcanon:shadow-scan` persists agent findings into the shadow DB while leaving live byte-identical | Test 8 — shasum -a 256 assertion holds; Test 9 — `Shadow scan complete` + shadow DB exists |
| 5 | `applyPendingOverrides` runs against the shadow QE inside `scanRepos` with no shadow-specific code | The hook is called unconditionally on the QE arg in manager.js:805 (Plan 117-02). Shadow QE wraps the SHADOW DB → reads/writes shadow `scan_overrides`. No additional test needed; the contract is structural. |
| 6 | When the shadow DB already exists, `cmdShadowScan` prints a one-line warning and proceeds | Test 10 — `Existing shadow DB will be overwritten` in stderr + `Shadow scan complete` in stdout, exit 0 |

## Artifacts Created

### `plugins/arcanon/worker/db/pool.js` — `getShadowQueryEngine(projectRoot, opts)`
NEW exported function. Always-fresh QE — never enters the pool cache. Inline pragma block + `runMigrations(db)` mirrors the existing `getQueryEngineByHash` pattern. Returns `null` when shadow DB absent and `opts.create !== true`. Caller closes via `qe._db.close()`. JSDoc cross-references RESEARCH §1 (option choice) and §3 (atomic-promote constraint — same-FS placement).

### `plugins/arcanon/worker/server/http.js` — `POST /scan-shadow` route
- Validates `?project=<root>`.
- Pre-stats the would-be shadow path for `reused_existing` flag.
- Reads the LIVE DB's repos table READ-ONLY (fresh better-sqlite3 handle, NOT through `getQueryEngine` pool — see Decision #2 above).
- Opens shadow QE via `getShadowQueryEngine(root, {create: true})`.
- FORCES `options.skipHubSync = true` on the call into `scanRepos` (caller-supplied options merged FIRST, then skipHubSync overwrites).
- Closes the shadow QE in BOTH success and error paths.
- 503 with the same agentRunner-not-initialized message as `/api/rescan` (118-02 parity).

### `plugins/arcanon/worker/cli/hub.js` — `cmdShadowScan` + HANDLERS registration
- Silent no-op when no `impact-map.db` (NAV-01).
- Pre-check warning to stderr if shadow DB exists.
- Forwards `--full` flag as `{options:{full:true}}`.
- Human output line + `Next: /arcanon:diff --shadow…` hint.
- `--json` emits `{shadow_db_path, results, reused_existing}`.
- Registered as `"shadow-scan": cmdShadowScan` (hyphenated key — first such entry in HANDLERS).

### `plugins/arcanon/commands/shadow-scan.md`
Slash-command markdown wrapper. Frontmatter: `description`, `argument-hint: "[--full] [--json]"`, `allowed-tools: Bash`. Body: standard help block + worker-running check + dispatch through `hub.sh shadow-scan $ARGUMENTS`. Documents the byte-identity + no-hub-upload + non-interactive overwrite contracts.

### `plugins/arcanon/worker/scan/manager.js` — `options.skipHubSync` gate
Wraps the entire HUB-01 hub-sync `try/catch` in `if (!options.skipHubSync) { … } else { slog INFO … }`. Default behaviour for live scans is preserved (skipHubSync defaults to undefined/false → branch enters the existing block unchanged).

### `plugins/arcanon/worker/index.js` — test agent stub schemas fix
Added `schemas: []` to the stubbed agent JSON (Rule 2 — see Deviations below).

### `plugins/arcanon/tests/fixtures/shadow/{seed.sh,seed.js}`
Bats fixture seeder. Mirrors rescan/verify pattern: real git repo + canonical migration chain 001..017 + idempotent reset. Inserts 1 repo (api), 2 services (api-svc, auth-svc), 1 connection, 1 prior `scan_versions` row.

### `tests/shadow-scan.bats` (13 cases)
- Tests 1-6: `getShadowQueryEngine` (fresh-open, uncached, live/shadow independence, create=true, create=false, migration head).
- Tests 7-13: `/scan-shadow` route + `cmdShadowScan` + slash command (200 dispatch, byte-identity, happy path, existing-shadow warning, silent contract, command-surface frontmatter, --json shape).

### `tests/commands-surface.bats` — SHADOW-01 regressions
Extended iteration list with `shadow-scan`. Two new SHADOW-01 assertions (`/arcanon:shadow-scan declares allowed-tools: Bash`, `worker/cli/hub.js registers "shadow-scan": cmdShadowScan`).

### `plugins/arcanon/CHANGELOG.md` — Unreleased / Added entry

## Files Modified

See key_files frontmatter above.

## Tests Added

| Suite | Cases | Status |
|-------|-------|--------|
| `tests/shadow-scan.bats` (Tasks 1+2) | 13 | 13 PASS |
| `tests/commands-surface.bats` (SHADOW-01 regressions) | +2 | 20/20 PASS (was 18) |
| Plan-adjacent neighbours: rescan.bats / scan-overrides-apply.bats / verify.bats | 14 | 14 PASS (no regression) |
| Plan-adjacent node tests: manager / overrides / http | 112 | 112 PASS (no regression) |

## Decisions

1. **Always-fresh uncached shadow QE (RESEARCH §1 Option B).** Live `getQueryEngine` is unchanged. Live and shadow can never collide because they don't share a code path.
2. **READ-ONLY open of live DB for repo-list lookup.** Going through the `getQueryEngine` pool would cache a writable handle and flip `journal_mode` to WAL, mutating the live file's first 100 bytes — breaking the byte-identity contract asserted by Test 8. The readonly path adds 6 lines but anchors the read-only-for-live invariant.
3. **`options.skipHubSync` added to `scanRepos` and FORCED true by the route handler.** T-119-01-06: synthetic shadow data must NEVER upload. Caller-supplied options can NOT override (we spread caller first, then `{skipHubSync:true}` overwrites). One-line `slog('INFO', ...)` makes the suppression visible in the worker log.
4. **Existing shadow DB → one-line stderr warning + proceed.** Non-interactive (RESEARCH §6 Q4).
5. **Hyphenated HANDLERS key (`"shadow-scan": cmdShadowScan`).** First such entry in HANDLERS — matches the slash-command name exactly.
6. **Live + shadow currently share the scan-lock key.** Open question for 119-02 (see below).
7. **Test agent stub extended with `schemas: []`.** Rule 2 — without it, every stubbed scan returns `findings: null` and the shadow DB stays empty.

## Threat Model Status

All seven threats from the PLAN's `<threat_model>` are addressed as documented:

| Threat ID | Status | Note |
|-----------|--------|------|
| T-119-01-01 | accept (per plan) | Shadow DB inherits sha256-hashed project dir; same trust surface as live |
| T-119-01-02 | mitigated | Route closes shadow QE in both success and error paths |
| T-119-01-03 | accept (per plan) | Same `?project=` validator as `/scan` |
| T-119-01-04 | mitigated | Live + shadow share the scan-lock key (open item for 119-02) |
| T-119-01-05 | accept (per plan) | Inherits `~/.arcanon/projects/<hash>/` perms |
| T-119-01-06 | mitigated | `options.skipHubSync=true` FORCED by route handler; flag added to scanRepos |

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: scan-pipeline-options-extension | plugins/arcanon/worker/scan/manager.js | First v0.1.4 plan to add a NEW field to scanRepos's options object (`skipHubSync`). The field is purely additive (default false → existing behaviour), gated only at the hub-sync block, and FORCED by the route handler — not exposed to user input. Reviewer focus: the `if (options.skipHubSync) { else { existing block } }` wrapper preserves the entire hub-sync flow unchanged for live scans. |
| threat_flag: live-db-readonly-open | plugins/arcanon/worker/server/http.js | The `/scan-shadow` route opens the live `impact-map.db` via a fresh better-sqlite3 readonly connection (NOT through the pool). This is the FIRST place in the codebase that does so without going through `getQueryEngine` / `getQueryEngineByHash`. Reviewer focus: the `{readonly: true}` flag is what guarantees no journal_mode pragma is written back to the live file (which would break Test 8's byte-identity contract). |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Test agent stub missing `schemas: []`**

- **Found during:** Task 2, Test 8 debug. The bats run showed Test 8 failing because the live DB hash differed before/after — investigated and found the live hash WAS changing because of the `getQueryEngine` pool cache (root cause for the readonly-open decision below). But also surfaced a SECOND issue: every stubbed scan was returning `"missing required field: schemas (must be an array)"`, meaning `parseAgentOutput` rejected the stub output and `persistFindings` was never called. The shadow DB was being created but staying schema-only — no shadow data ever written.
- **Why critical:** A shadow scan that creates an empty schema-only DB satisfies the byte-identity contract for live but defeats the entire point of SHADOW-01 (the operator can't `/arcanon:diff --shadow` a DB that has no findings). The 118-02 rescan tests didn't catch this because they assert on `scan_versions COUNT` (which `beginScan` increments BEFORE `parseAgentOutput` runs).
- **Fix:** Added `schemas: []` to the stubbed agent JSON in `worker/index.js`. Comment cites the SHADOW-01 origin and explains why 118-02's rescan tests were blind to the issue.
- **Files modified:** `plugins/arcanon/worker/index.js`.
- **Commit:** `6960762` (alongside the route + handler).

**2. [Rule 1 — Bug] Live DB byte-identity broken by pool-cache pragma writes**

- **Found during:** Task 2, Test 8 debug. Initial implementation used `resolve(projectRoot)` (which delegates to `getQueryEngine`) to read the LIVE DB's repos table. The first call to `getQueryEngine` opens via `openDb`, which calls `db.pragma("journal_mode = WAL")`. This pragma write mutates the live file's header — breaking the byte-identity contract asserted in Test 8.
- **Why critical:** Test 8 is the load-bearing assertion for the entire shadow workflow. If a shadow scan can mutate the live file, the read-only-for-live invariant is violated and the whole "validate before commit" promise dies.
- **Fix:** Open a fresh `Database(liveDbPath, {readonly: true})` handle, query the repos table, close. NEVER go through the pool. Documented inline + threat-flagged in this SUMMARY (`live-db-readonly-open`).
- **Files modified:** `plugins/arcanon/worker/server/http.js`.
- **Commit:** `6960762` (alongside the route + handler).

**3. [Rule 3 — Plan task name drift / Plan extension] `--full` forwarded as `{options:{full:true}}` not `{full:true}` body root**

- **Found during:** Task 2 implementation reading the existing `/scan` route shape vs the plan's "same shape as `/scan` body" wording.
- **Issue:** The plan's `<action>` step 2 says "Body: `{}` (defaults — accept all repos, default options). If `flags.full` is true, body becomes `{options: {full: true}}`." This matches the existing `/scan` body convention exactly. No actual deviation — calling it out here for clarity since the route also accepts `repoPaths` in the body's root (mirrors `/scan` shape, not `options.repoPaths`).
- **Fix:** None — implementation matches the plan's wording verbatim. Documented for posterity.

## Open Items

1. **Scan-lock strategy for live + shadow.** Currently both live and shadow scans hash to the same lock key (manager.js:534-566 — `scanLockHash(repoPaths)`). This means a shadow scan blocks during a live scan and vice-versa. **Question for 119-02:** should shadow scans use a separate lock key (e.g., `${repoPathsHash}-shadow`)? Plan 119-01 leaves this as-is — the conservative choice that matches the existing single-DB lock contract. If 119-02 user feedback says "shadow blocks live too aggressively", revisit then. (Documented in T-119-01-04.)

2. **Production agent-runner wiring.** `/scan-shadow` inherits the same gap as `/api/rescan` (118-02): production worker startup does not wire an agent runner. Tests use `ARCANON_TEST_AGENT_RUNNER=1`. Production users running `/arcanon:shadow-scan` from the CLI will see a 503 with the documented bootstrap message until either (a) a real agent runner is wired into `worker/index.js` startup, or (b) `/arcanon:shadow-scan` is repurposed to dispatch through the host's Claude Task tool instead of the worker (mirroring `/arcanon:map`'s host-orchestrated path). Logged in `deferred-items.md` under Phase 118-02; this plan inherits the same constraint.

3. **Behavior when Phase 117 lands new override actions.** The shadow scan path will pick them up automatically (the apply-hook fires inside `scanRepos`). No 119-01 work needed unless 117 changes the apply-hook signature (currently `(scanVersionId, queryEngine, slog)`). Surface in 119-02 SUMMARY if observed.

4. **`reused_existing` semantics when the route's pre-stat races with a parallel shadow-scan.** The route stats the would-be shadow path BEFORE opening the QE. If a parallel `/scan-shadow` has just created the file between our stat and our open, `reused_existing` reports `false` even though the QE re-opened an existing file. Acceptable race window (microseconds); the `reused_existing` flag is informational, not load-bearing.

## Verification Summary

| Gate | Expected | Actual |
|------|----------|--------|
| `bats tests/shadow-scan.bats` | 13 cases pass | 13/13 PASS |
| `bats tests/commands-surface.bats` (SHADOW-01 regressions) | 18+2 pass | 20/20 PASS |
| `bats tests/rescan.bats` (no regression) | 5 pass | 5/5 PASS |
| `bats tests/scan-overrides-apply.bats` (no regression) | 2 pass | 2/2 PASS |
| `bats tests/verify.bats` (no regression) | 7 pass | 7/7 PASS |
| `node --test worker/scan/manager.test.js` (no regression) | 64 pass | 64/64 PASS |
| `node --test worker/scan/overrides.test.js` (no regression) | 15 pass | 15/15 PASS |
| `node --test worker/server/http.test.js` (no regression) | 33 pass | 33/33 PASS |
| `grep -c "getShadowQueryEngine" pool.js` | ≥1 (export line) | 1 |
| `grep -c "/scan-shadow" http.js` | ≥1 (route) | 4 (route + comments) |
| `grep -c "shadow-scan: cmdShadowScan" hub.js` | 1 | 1 |
| `grep -c "skipHubSync" manager.js` | ≥1 | 4 |
| `grep -c "shadow" CHANGELOG.md` | ≥1 (new entry) | 11 |
| Per-task one-commit-each (TDD) | 4 commits (RED+GREEN per task) | 4 commits in `git log --oneline` |
| Live DB byte-identity (Test 8) | sha256 unchanged | sha256 unchanged |
| `node --check` on all modified .js files | OK | OK |

## Cross-Plan Coordination

- **117-02 (apply-hook) — already shipped.** `applyPendingOverrides` fires unconditionally inside `scanRepos` between `persistFindings` and `endScan`. Because the shadow QE wraps the SHADOW DB, the hook reads/writes the shadow `scan_overrides` table. ZERO shadow-specific code in 117-02. Validated by code inspection (manager.js:805 unchanged, calling on the QE arg).
- **118-02 (`/api/rescan` + agent-runner stub) — already shipped.** This plan reuses (a) the `ARCANON_TEST_AGENT_RUNNER=1` env-var-gated stub installed in `worker/index.js`, (b) the agent-runner-not-initialized 503 pattern in HTTP routes, and (c) the bats fixture pattern (real git repo + canonical migration chain). The only change to 118-02 surface: extended the test agent stub with `schemas: []` so `parseAgentOutput` doesn't reject the stubbed JSON (Rule 2 deviation above).
- **119-02 (next plan: `/promote-shadow` + `/diff --shadow`) — not yet shipped.** Will:
  - Add `evictLiveQueryEngine(projectRoot)` to pool.js (called from `cmdPromoteShadow` BEFORE the rename).
  - Add `cmdPromoteShadow` (does the WAL-checkpoint + atomic fs.rename + sidecar handling per RESEARCH §3).
  - Extend `cmdDiff` with `--shadow` flag (passes shadow QE as the second arg to Phase 115's diff engine).
  - Will inherit the same agent-runner-not-initialized constraint for any rescan-after-promote workflows.

## Self-Check: PASSED

- FOUND: plugins/arcanon/worker/db/pool.js (getShadowQueryEngine export)
- FOUND: plugins/arcanon/worker/server/http.js (POST /scan-shadow route)
- FOUND: plugins/arcanon/worker/cli/hub.js (cmdShadowScan + HANDLERS entry)
- FOUND: plugins/arcanon/commands/shadow-scan.md
- FOUND: plugins/arcanon/tests/fixtures/shadow/seed.sh
- FOUND: plugins/arcanon/tests/fixtures/shadow/seed.js
- FOUND: tests/shadow-scan.bats
- FOUND: commit c48e966 (test 119-01 add failing tests + fixture for getShadowQueryEngine)
- FOUND: commit e499091 (feat 119-01 add getShadowQueryEngine to pool.js)
- FOUND: commit 68655ec (test 119-01 add failing tests for /scan-shadow + cmdShadowScan + slash command)
- FOUND: commit 6960762 (feat 119-01 ship POST /scan-shadow + cmdShadowScan + slash command)
- All 13 shadow-scan.bats cases PASS; 20 commands-surface.bats PASS; 5 rescan.bats PASS; 2 scan-overrides-apply.bats PASS; 7 verify.bats PASS.
- All 6 PLAN truths validated (Test → Truth mapping above).
- All 8 PLAN success_criteria pass (TDD gate: RED commits c48e966 + 68655ec precede GREEN commits e499091 + 6960762).

## Commits (4)

| # | Hash    | Message |
|---|---------|---------|
| 1 | c48e966 | test(119-01): add failing tests + fixture for getShadowQueryEngine (SHADOW-01) |
| 2 | e499091 | feat(119-01): add getShadowQueryEngine to pool.js — uncached fresh-open (SHADOW-01) |
| 3 | 68655ec | test(119-01): add failing tests for /scan-shadow + cmdShadowScan + slash command |
| 4 | 6960762 | feat(119-01): ship POST /scan-shadow + cmdShadowScan + slash command (SHADOW-01) |
