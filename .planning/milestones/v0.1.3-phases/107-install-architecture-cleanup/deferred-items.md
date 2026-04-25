# Phase 107 — Deferred Items

Items discovered during Phase 107 execution that are out-of-scope for the
phase per SCOPE BOUNDARY (only auto-fix issues directly caused by the current
task's changes).

## impact-hook HOK-06 latency test failing (pre-existing)

**Discovered during:** Plan 107-03 final `make test` run
**Test:** `tests/impact-hook.bats` — `HOK-06: p99 latency < ${IMPACT_HOOK_LATENCY_THRESHOLD:-50}ms over 100 iterations`
**Symptom:** `impact-hook latency: iterations=100 p99=184ms threshold=50ms` → FAIL
**Cause:** `plugins/arcanon/scripts/impact-hook.sh` p99 wall-clock latency on this developer machine (Apple Silicon, Node 25, bash 5) is ~150-200ms, well above the 50ms hard threshold set during v0.1.1.
**Why it's out of scope for Phase 107:** The impact-hook script is untouched by Phase 107. The failure is in the impact-hook performance budget, not in any install-architecture file.
**Status:** Did not break under Phase 107 changes. The same threshold-vs-machine tension existed before this phase.
**Handoff candidates:**
1. Phase 113 (Verification Gate) — re-evaluate hook performance budgets across the v0.1.3 milestone.
2. A separate hook-perf retune ticket — possibly raising the default hard threshold from 50ms to 200ms with the documented `IMPACT_HOOK_LATENCY_THRESHOLD` env override remaining for stricter local enforcement (mirrors the same pattern Plan 107-03 used for `INSTALL_DEPS_LATENCY_THRESHOLD`).

## Untracked / Unstaged file: plugins/arcanon/worker/db/query-engine.js

**Discovered during:** Plan 107-03 commit-time `git status`
**Cause:** Phase 109 (path canonicalization) added `canonicalizePath()` helper + persistFindings touch-up. Edit was already in the working tree before Phase 107-03 started; orchestrator may have left it staged across phases.
**Why it's out of scope for Phase 107-03:** Owned by a different phase + plan (109-02). Not in Plan 107-03's `<files>` declaration.
**Status:** Left untouched by 107-03's commits. The phase 109 work landed in commits `a23ad61` + `7548d44` + `04a1a42` — that file is now part of phase 109 history, not phase 107.
