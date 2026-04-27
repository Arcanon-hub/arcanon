---
gsd_state_version: 1.0
milestone: v0.1.4
milestone_name: Operator Surface
status: executing
stopped_at: Completed 121-02-PLAN.md (INT-07/08/09)
last_updated: "2026-04-27T06:55:24.153Z"
last_activity: 2026-04-27
progress:
  total_phases: 9
  completed_phases: 7
  total_plans: 21
  completed_plans: 18
  percent: 86
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-25)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** Phase 121 — Integration Consumption Layer

## Current Position

Phase: 121 (Integration Consumption Layer) — EXECUTING
Plan: 3 of 3
Status: Ready to execute
Last activity: 2026-04-27

## Performance Metrics

**Velocity:**

- Total plans completed: 207 (v1.0–v5.8.0 + v0.1.0 + v0.1.1 12 plans + v0.1.2 9 plans + v0.1.3 14 plans)
- Total milestones shipped: 22 (Ligamen v1.0–v5.8.0 + Arcanon v0.1.0 + v0.1.1 + v0.1.2 + v0.1.3)

## Accumulated Context

### Decisions

- **v0.1.4 bundles all four remaining Mediums** (THE-1023..1026) instead of splitting v0.1.4/v0.1.5. Rationale: same scope band as v0.1.1/v0.1.2/v0.1.3, all operator-facing surface improvements, wave ordering within the milestone preserves low-risk-first benefit without doubling release ceremony.
- **`scan_overrides` table (THE-1024) gets a discuss-phase before plan-phase.** Only ticket with real design surface — schema needs careful thought (override_id, kind, target_id, action, payload, applied_in_scan_version_id).
- **`/arcanon:status` extension narrows THE-1025 Item 1 to active scope.** v0.1.1 SessionStart enrichment already shows scan age passively; this milestone adds parity in `/arcanon:status` output + git-commits-since-scan signal.
- **`hub.evidence_mode` defaults to `"full"` for back-compat.** `"hash-only"` is opt-in; existing CI flows keep working.
- **Shadow-scan namespace at `$ARCANON_DATA_DIR/projects/<hash>/impact-map-shadow.db`** (sibling of `impact-map.db`). Atomic promote = backup + swap.
- NAV-02 ships /arcanon:view as a pure markdown command (no Node handler) per RESEARCH §2 dispatch-precedence finding. Negative regression test in commands-surface.bats guards against future contributors adding view: cmdView to hub.js HANDLERS.
- 118-01: Service-name resolver extracted into separate worker/cli/correct-resolver.js for testability
- 118-01: Resolver throws structured { code, message, exitCode } objects (not Error instances) so callers control I/O
- 118-01: created_by='cli' marker distinguishes operator-staged overrides from system-generated rows
- 118-02: scanSingleRepo lives in manager.js as a thin scanRepos wrapper (single-line forces options.full=true) — encapsulates the bypass invariant in one place
- 118-02: ARCANON_TEST_AGENT_RUNNER env-var stub installed in worker/index.js is the canonical mechanism for tests that drive scans inside the worker; production never sets it
- 118-02: agentRunner-not-initialized in production is surfaced as 503 (not 500) with a clear message; production agent-runner wiring deferred to Phase 119+ (see deferred-items.md)
- 119-01: Always-fresh uncached shadow QE (RESEARCH §1 Option B) — sidesteps openDb singleton problem; live and shadow can never collide
- 119-01: options.skipHubSync flag added to scanRepos and FORCED true by /scan-shadow route handler — synthetic shadow data must NEVER upload (T-119-01-06)
- 119-01: live DB read READ-ONLY (fresh better-sqlite3 handle, NOT through getQueryEngine pool) for repo-list lookup — going through pool would flip journal_mode pragma and break byte-identity (Test 8)
- WAL sidecars renamed alongside main DB on both backup and promote steps
- evictLiveQueryEngine clears BOTH the pool.js Map AND the database.js _db singleton (Rule 1 deviation - new _resetDbSingleton export)
- Active scan-lock guard via filesystem scan + PID liveness check (T-119-02-04) refuses promote during any live scan referencing repos under cwd
- cmdDiff --shadow reuses Phase 115 diffScanVersions(dbA, dbB, scanIdA, scanIdB) engine via dynamic import - Shape A landed verbatim, no fallback needed
- INT-02 + INT-04 shipped: --offline short-circuit (Step 0.5, no hub.sh) and --spec repeatable (bypasses find_openapi_spec). Markdown-as-spec testing convention; 10 new bats tests
- INT-05 ships known-externals.yaml catalog as DATA-ONLY (zero Node code) — Phase 121 owns the consumer/loader/matcher. Glob-style host patterns (not regex), kebab-case names, list shape (not name-keyed map) for diff-friendly ordering.
- 121-01: per-repo actor labeling pass over per-service — actors are global; one DB write per actor regardless of how many services connect to it
- 121-01: self-healing UPDATE-with-NULL on non-match — removing a catalog entry clears stale labels on next scan
- 121-01: loader accepts both 'entries:' (plan-assumed) and 'externals:' (Phase 120 actual) top-level keys; both map and list forms — single point of adaptation
- 121-01: leading '*.foo.com' wildcard matches one-OR-MORE leading DNS labels (excluding bare suffix); mid-string '*' matches exactly one label
- 121-02: loadMergedCatalog single-call seam at scanRepos head — manager.js swap is one line; future catalog merges only touch this point
- 121-02: User-extension re-read every scan, shipped portion module-cached — asymmetric caching matches asymmetric edit cadence

### Pending Todos

None. Awaiting requirements definition + roadmap.

### Blockers/Concerns

- macOS HOK-06 hook p99 latency caveat — platform constraint; CI uses threshold=100, not a regression.
- `commands/update.md:21` `claude plugin update --help` reference is the only `--help` string in commands/. v0.1.4 will introduce real `--help` strings everywhere; verification grep should refine to `/arcanon:.*--help` or whitelist that one host-CLI reference.

## Session Continuity

Last session: 2026-04-27T06:55:24.145Z
Stopped at: Completed 121-02-PLAN.md (INT-07/08/09)
Resume file: None
