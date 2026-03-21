---
phase: 059-runtime-dependency-installation
plan: 01
subsystem: infra
tags: [bash, npm, bats, hooks, session-start, idempotency, sentinel]

# Dependency graph
requires:
  - phase: 059-runtime-dependency-installation
    provides: runtime-deps.json manifest and phase context
provides:
  - install-deps.sh script with diff-based idempotency and failure cleanup
  - hooks.json updated with install-deps.sh as first SessionStart entry at timeout 120
  - Bats test suite covering DEPS-01 through DEPS-04
affects: [059-runtime-dependency-installation, 060-mcp-verification, 061-version-bumping]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-blocking bash hook pattern: set -euo pipefail + trap 'exit 0' ERR"
    - "Diff-based sentinel idempotency: compare manifest to CLAUDE_PLUGIN_DATA sentinel file"
    - "Double-check guard: sentinel match AND node_modules/better-sqlite3 presence"

key-files:
  created:
    - plugins/ligamen/scripts/install-deps.sh
    - tests/install-deps.bats
  modified:
    - plugins/ligamen/hooks/hooks.json

key-decisions:
  - "Install into CLAUDE_PLUGIN_ROOT via npm install --prefix (ESM walks up to find node_modules)"
  - "Sentinel stored in CLAUDE_PLUGIN_DATA for persistence across plugin updates"
  - "Double-check: re-install if sentinel mismatches OR better-sqlite3 dir missing"
  - "On npm failure: delete partial node_modules + remove sentinel so next session retries clean"
  - "All npm output to stderr; stdout stays clean for hook JSON output"
  - "Stdout cleanliness test uses direct capture with 2>/dev/null rather than bats run (bats run merges stderr into output)"

patterns-established:
  - "Hook scripts guard CLAUDE_PLUGIN_DATA before doing any plugin-context work (dev mode safety)"
  - "npm install --omit=dev --no-fund --no-audit --package-lock=false for clean installs"

requirements-completed: [DEPS-01, DEPS-02, DEPS-03, DEPS-04]

# Metrics
duration: 2min
completed: 2026-03-21
---

# Phase 59 Plan 01: Runtime Dependency Installation Summary

**SessionStart hook that installs MCP runtime npm deps into CLAUDE_PLUGIN_ROOT using diff-based sentinel idempotency with failure cleanup and 9-test bats coverage**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-21T17:44:40Z
- **Completed:** 2026-03-21T17:46:44Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Created install-deps.sh: non-blocking bash hook with diff sentinel idempotency, npm install into CLAUDE_PLUGIN_ROOT, and partial-install cleanup on failure
- Updated hooks.json: install-deps.sh wired as first SessionStart entry at timeout 120 (session-start.sh remains second at timeout 10)
- Created tests/install-deps.bats: 9 tests covering DEPS-01 through DEPS-04 — dev mode guard, stdout cleanliness, sentinel skip, missing sentinel install, sentinel update, better-sqlite3 double-check, timeout value, hook ordering

## Task Commits

Each task was committed atomically:

1. **Task 1: Create install-deps.sh with diff-based idempotency** - `ef040cf` (feat)
2. **Task 2: Update hooks.json with install-deps.sh as first SessionStart entry** - `d15068a` (feat)
3. **Task 3: Create bats tests for install-deps.sh** - `8507566` (test)

## Files Created/Modified
- `plugins/ligamen/scripts/install-deps.sh` - Non-blocking SessionStart hook that installs runtime npm deps into CLAUDE_PLUGIN_ROOT
- `plugins/ligamen/hooks/hooks.json` - Added install-deps.sh as first SessionStart entry at timeout 120
- `tests/install-deps.bats` - 9-test bats suite covering DEPS-01 through DEPS-04

## Decisions Made
- Stdout cleanliness test uses direct variable capture with `2>/dev/null` instead of bats `run` command — bats `run` merges stderr into `$output` by default, so npm install output (which goes to stderr) would cause a false failure
- Test uses `is-number` (tiny npm package) as test dependency instead of real deps for fast test execution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed bats stdout cleanliness test to use direct capture instead of `run`**
- **Found during:** Task 3 (bats tests)
- **Issue:** Initial test used `run bash -c "..."` which merges stderr into `$output` in bats, causing the stdout cleanliness test to fail because npm output (stderr) was included in `$output`
- **Fix:** Changed to direct shell variable assignment `STDOUT_ONLY=$(... 2>/dev/null)` to capture only stdout for assertion
- **Files modified:** tests/install-deps.bats
- **Verification:** All 9 tests pass with `./tests/bats/bin/bats tests/install-deps.bats`
- **Committed in:** 8507566 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test approach)
**Impact on plan:** Minor test implementation fix; no behavior changes to production scripts.

## Issues Encountered
None - all production scripts worked correctly on first run.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- install-deps.sh ready to be invoked on every SessionStart
- hooks.json correctly wired with 120s timeout for native compilation
- Plan 59-02 (MCP wrapper self-healing) can now reference install-deps.sh patterns
- Known blocker remains: empirical confirmation that CLAUDE_PLUGIN_ROOT is writable during live SessionStart hook (flagged in STATE.md)

---
*Phase: 059-runtime-dependency-installation*
*Completed: 2026-03-21*
