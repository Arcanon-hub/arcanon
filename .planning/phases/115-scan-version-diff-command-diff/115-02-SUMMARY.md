---
phase: 115-scan-version-diff-command-diff
plan: 02
subsystem: arcanon-plugin / cli
tags: [nav-04, read-only, command-surface, diff]
requirements_completed: [NAV-04]
dependency_graph:
  requires:
    - "plugins/arcanon/worker/diff/scan-version-diff.js — diffScanVersions(dbA, dbB, scanIdA, scanIdB) (115-01)"
    - "plugins/arcanon/worker/diff/resolve-scan.js — resolveScanSelector(db, selector, projectRoot?) (115-01)"
    - "plugins/arcanon/worker/db/pool.js — projectHashDir export (114-01)"
    - "plugins/arcanon/lib/worker-client.sh — _arcanon_is_project_dir (114-01)"
  provides:
    - "plugins/arcanon/commands/diff.md — slash-command markdown wrapper"
    - "plugins/arcanon/worker/cli/hub.js cmdDiff — registered in HANDLERS as `diff: cmdDiff`"
    - "plugins/arcanon/tests/fixtures/diff/seed.sh + seed.js — 5-mode fixture seeder (default, same, iso, head, branch)"
  affects:
    - "tests/commands-surface.bats iteration list — extended from 12 to 13 commands (added `diff`); +2 NAV-04 @test blocks"
    - "plugins/arcanon/worker/cli/hub.js main() — now passes `positional` to handlers (backward-compatible: JS ignores extra args)"
key_files:
  created:
    - "plugins/arcanon/commands/diff.md (slash-command wrapper, ~50 lines incl Help section)"
    - "plugins/arcanon/tests/fixtures/diff/seed.js (5-mode fixture seeder, ~220 lines)"
    - "plugins/arcanon/tests/fixtures/diff/seed.sh (thin wrapper around seed.js, ~40 lines)"
    - "tests/diff.bats (13-test bats E2E, repo-root location)"
  modified:
    - "plugins/arcanon/worker/cli/hub.js (+cmdDiff handler ~140 lines, +HANDLERS entry, +main() positional propagation)"
    - "tests/commands-surface.bats (iteration list 12 → 13; +2 NAV-04 @test blocks)"
    - "plugins/arcanon/CHANGELOG.md (Added entry under [Unreleased])"
decisions:
  - "Same-DB diff detects added/removed only — production schema has UNIQUE(services.repo_id, services.name) and UNIQUE(connections.source_service_id, target_service_id, protocol, method, path) which prevents same row across two scan_version_ids in a single DB. True modify-detection requires the shadow-DB pattern (Phase 119) where two separate DBs each carry their own row identity."
  - "Test 12 (originally 'modified-row field diff') restructured to assert that the Modified section header prints with count 0 — modify-detection isn't possible in this fixture's single-DB scenario by schema construction."
  - "fixture seeder lives at plugins/arcanon/tests/fixtures/diff/, bats files at repo-root tests/ — matches Phase 114 convention (NIT 8 from 114-02)."
  - "main() in hub.js now passes `positional` as second arg to all handlers — backward-compatible because existing handlers accept (flags) only and JS ignores extra args. cmdDiff is the first handler that consumes positional."
  - "cmdDiff opens an isolated read-only Database connection (`{readonly: true, fileMustExist: true}`) — does NOT use openDb()'s process-cached singleton. Same pattern as cmdDoctor (114-03 BLOCK 2 fix). Read-only flag is enforced at the C layer."
  - "No worker auto-start in commands/diff.md — cmdDiff bypasses the worker entirely with direct SQLite access. Faster + no port dependency."
  - "branch-mode seeder requires a real tmp git repo (--git-repo arg). Test 9 builds it with mkdtemp + git init + two branches before invoking the seeder."
  - "Inline execution by orchestrator after two consecutive 24+ minute gsd-executor stream timeouts with zero commits. Plan content unchanged — same 2-task structure collapsed into one commit for atomicity. Recorded as a process note for future sessions."
metrics:
  duration: "~30 minutes (inline, after two timed-out gsd-executor attempts)"
  tasks_completed: 2 / 2 (collapsed into 1 commit due to inline mode)
  files_created: 4
  files_modified: 3
  tests_added: 13 (diff.bats) + 2 (commands-surface.bats NAV-04 block) = 15 net new
  bats_pass_rate: "27/27 (13 diff.bats + 14 commands-surface.bats)"
  commits: 1 atomic commit (01728b6)
truths_validated:
  - "Running /arcanon:diff <scanA> <scanB> in a scanned Arcanon project prints a sectioned report with Services + Connections sections and a Summary line"
  - "Running /arcanon:diff in a directory with no impact-map.db produces zero output and exits 0 (silent contract)"
  - "Running /arcanon:diff --json emits a JSON object with project_root, scanA, scanB, services, connections, summary"
  - "Bare integers, HEAD/HEAD~N, ISO dates, and branch names all resolve correctly to scan_versions.id"
  - "Same-scan input prints 'identical' and exits 0"
  - "Missing scan ID exits 2 with friendly error containing the requested ID"
  - "diff: cmdDiff is registered in HANDLERS map at hub.js:1232"
discrepancies_for_downstream:
  - "Same-DB diff cannot detect 'modified' services or connections due to UNIQUE constraints. Phase 119's shadow-DB pattern resolves this. Surface in Phase 119 plan (already noted in 119's <assumptions_about_phase_115> block)."
follow_ups:
  - "Phase 119 should add /arcanon:diff --shadow that swaps one Database handle for the shadow DB, enabling modify-detection."
  - "Phase 122 release-gate should manually smoke /arcanon:diff in the Arcanon repo itself with two real scan versions."
---

# Plan 115-02 Summary — `/arcanon:diff` CLI

Shipped the operator-facing half of NAV-04. Phase 115's diff engine
(115-01) is now reachable via `/arcanon:diff <scanA> <scanB> [--json]`.

## What Shipped

**New command surface:**
- `commands/diff.md` — markdown wrapper, silent in non-Arcanon dirs
- `cmdDiff` in `worker/cli/hub.js` — opens read-only Database, dynamically imports the engine + resolver, formats human or JSON output
- HANDLERS entry: `diff: cmdDiff`
- `main()` updated to propagate `positional` to all handlers (backward-compatible)

**Test coverage:**
- 13 bats E2E tests in `tests/diff.bats` covering: silent-no-op, usage errors,
  scan-not-found, integer-ID happy path, same-scan short-circuit, HEAD/HEAD~N,
  ISO date resolution, branch heuristic (with real tmp git repo), `--json`
  parity, HEAD~50 out-of-range, Modified section sanity, frontmatter regression
- 5-mode fixture seeder (`default`, `same`, `iso`, `head`, `branch`)
- 2 new NAV-04 tests in `tests/commands-surface.bats` (frontmatter + handler registration)

## Cross-Phase Contracts

**Engine signature consumed (locked by 115-01):**
```js
diffScanVersions(dbA, dbB, scanIdA, scanIdB) -> {same_scan, services, connections, summary}
resolveScanSelector(db, selector, projectRoot?) -> {scanId, resolvedFrom}
```

cmdDiff opens ONE Database handle and passes it twice (`db, db`) for live
same-DB diff. Phase 119's `/arcanon:diff --shadow` will swap one handle for
the shadow DB — a one-line change.

## Known Limitation

Production schema's UNIQUE constraints (services.repo_id+name, connections
source/target/protocol/method/path) prevent the same row from appearing in
two scan_version_ids within a single DB. Same-DB diff therefore detects
**added/removed only**. True modify-detection is the shadow-DB pattern
(Phase 119). Documented in CHANGELOG, plan, and tests.

## Process Note

Two consecutive gsd-executor agent attempts on this plan timed out at the
24-minute streaming threshold with zero commits each. Inline execution by
the main orchestrator completed the same 2-task plan in ~30 minutes,
including catching two seeder bugs (`repo_state.last_scan_iso` → wrong
column name; `services` UNIQUE schema reality requiring fixture restructure).
Plan content unchanged; only the agent-vs-inline execution path differed.
