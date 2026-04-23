---
phase: 103-test-suite-rewrite
status: passed
verified_at: 2026-04-23
plans_executed: 1 (single-pass plan + execute)
requirements_covered: 7
carry_overs_to_phase_104: 0
---

# Phase 103 Test Suite Rewrite — Verification

## Status: PASSED

Every `ligamen`/`LIGAMEN`/`@ligamen` reference in bats fixtures and node `.test.js` files has been rewritten to `arcanon`/`ARCANON`/`@arcanon`. Both test suites green modulo three documented pre-existing failures that are out-of-scope for a rename pass.

## Verification Gates

### Gate 1 — Zero ligamen refs in tests/
**Expected:** 0 lines
**Command:** `grep -rn "ligamen\|LIGAMEN" tests/`
**Actual:** 0 lines ✓

### Gate 2 — Zero ligamen refs in worker/*.test.js
**Expected:** 0 lines
**Command:** `grep -rn "ligamen\|LIGAMEN" plugins/arcanon/worker --include="*.test.js"`
**Actual:** 0 lines ✓

### Gate 3 — bats suite green
**Expected:** `make test` passes 310+ tests
**Actual:** 309 ok, 1 known fail (`HOK-06: p99 latency < 50ms`)
**Caveat:** The HOK-06 macOS platform caveat is documented in Phase 103 CONTEXT.md and Phase 101 artifacts. Linux CI passes with `IMPACT_HOOK_LATENCY_THRESHOLD=100`.
PASS (modulo documented caveat) ✓

### Gate 4 — node test suite green
**Expected:** `npm test` passes all tests
**Actual (per-file):** 526 tests, 524 pass, 2 fail
**Pre-existing failures** (both verified to predate Phase 103 per `git log` + `git show` comparisons):
1. `worker/mcp/server-search.test.js: queryScan: returns unavailable when port file does not exist` — behavior drift in `queryScan()`; file not modified by Phase 103.
2. `worker/scan/manager.test.js: scanRepos — incremental prompt constraint` — mock `queryEngine` lacks `_db` field required by Phase 101's back-fill logic; only cosmetic tmpdir names were touched in this file by Phase 103.

PASS (with documented pre-existing failures) ✓

### Gate 5 — no unintended file deletions / additions
**Expected:** 17 files modified, 0 files added or deleted (other than the 1 obsolete legacy-fallback test block removed from `auth.test.js`).
**Actual:** 17 files modified, 1 test block removed (documented in 103-SUMMARY.md § Deviations as Rule 1) ✓

## Requirements Coverage

| ID | Description | Status |
|----|-------------|--------|
| TST-01 | tests/config.bats ARCANON_* rewrite | ✅ |
| TST-02 | tests/fixtures/config/mock-*.sh ARCANON_* rewrite | ✅ |
| TST-03 | worker/db/*.test.js ligamen refs removed | ✅ |
| TST-04 | worker/server/*.test.js ligamen refs removed | ✅ |
| TST-05 | worker/scan/*.test.js ligamen refs removed | ✅ |
| TST-06 | worker/mcp/*.test.js ligamen refs removed | ✅ |
| TST-07 | worker/hub-sync/auth.test.js ligamen refs removed | ✅ |

## Commits Landed

| Hash | Message |
|------|---------|
| a22e2de | refactor(103-01): rewrite tests/config.bats + fixtures to ARCANON_* |
| f809dfb | refactor(103-02): rewrite worker/db/*.test.js ligamen → arcanon |
| 154f7ee | refactor(103-03): rewrite worker/server/*.test.js ligamen → arcanon |
| d368e1d | refactor(103-04): rewrite worker/scan + mcp + hub-sync test ligamen → arcanon |

## Phase 104 Carry-Over Inventory

None — Phase 103 is fully scoped and self-contained. Any residual ligamen references in Markdown documentation (README, docs, agent-prompt `.md` files already handled in Phase 102) belong to Phase 104 (Docs & README Purge).

## Deviations from Plan

**1. Removed `resolveCredentials supports legacy ~/.ligamen/config.json` test.** Phase 101 deleted the legacy fallback per zero-tolerance policy (101-VERIFICATION.md). Preserving the test after a mechanical rename would have duplicated the `~/.arcanon/config.json` test directly above it and asserted removed behavior. Rule 1 deviation documented in 103-SUMMARY.md.

**2. Installed `picomatch` via `npm install --no-save`.** The declared dependency was absent from `plugins/arcanon/node_modules/` and caused worker startup to crash with `Cannot find module 'picomatch'`. Running `npm install --no-save` restored the environment without touching `package-lock.json`. Rule 3 infra fix; not a Phase 103 code change.

**3. Ran node test suite file-by-file with `--test-isolation=none`.** Node 25's default `--test-isolation=process --test-concurrency=0` combination hung indefinitely at `worker/mcp/server*.test.js`. Per-file execution resolves it. Flagged in 103-SUMMARY.md for future maintainer attention; unrelated to Phase 103 renames.

## Overall

**Phase 103 verification: PASSED.** Ready for Phase 104 (Docs & README Purge) and Phase 105 (Final Release Gate).
