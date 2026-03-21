---
phase: 060-mcp-server-launch-verification
plan: 01
subsystem: testing
tags: [bats, mcp, json-rpc, chromadb, esm, node-modules]

# Dependency graph
requires:
  - phase: 059-mcp-install-pipeline
    provides: mcp-wrapper.sh, .mcp.json update, runtime-deps.json install pipeline
provides:
  - bats integration tests verifying MCP server launches from plugin root
  - 7 tests covering MCP-01 (server starts, 8 tools listed, no ERR_MODULE_NOT_FOUND) and MCP-03 (no NODE_PATH)
  - 3 tests covering ChromaDB graceful degradation when @chroma-core/default-embed is absent
affects: [future MCP phases, CI pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [JSON-RPC initialize + tools/list handshake for bats MCP testing, teardown() for bats cleanup of filesystem side-effects]

key-files:
  created:
    - tests/mcp-launch.bats
    - tests/mcp-chromadb-fallback.bats
  modified: []

key-decisions:
  - "assert_output --partial 'results' (not '\"results\"') because tool response wraps JSON in text content — output contains escaped quotes"
  - "Tests trivially pass when @chroma-core/default-embed is not installed (it is an optionalDependency not present in dev) — no rename needed"

patterns-established:
  - "MCP bats test pattern: JSON-RPC initialize + method call piped to node worker/mcp/server.js with timeout 5"
  - "ChromaDB fallback test: rename embed dir before test, restore inline, teardown() as safety net"

requirements-completed: [MCP-01, MCP-03]

# Metrics
duration: 2min
completed: 2026-03-21
---

# Phase 60 Plan 01: MCP Server Launch Verification Summary

**10 bats integration tests proving MCP server launches from plugin root with all 8 tools, no ERR_MODULE_NOT_FOUND, no NODE_PATH, and ChromaDB graceful degradation**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-21T17:48:48Z
- **Completed:** 2026-03-21T17:50:12Z
- **Tasks:** 2
- **Files modified:** 2 (created)

## Accomplishments

- 7 tests in `mcp-launch.bats` verifying server starts from plugin root, all 8 tools listed via tools/list, no module resolution errors, no NODE_PATH in .mcp.json, and root .mcp.json is empty
- 3 tests in `mcp-chromadb-fallback.bats` verifying server starts, all 8 tools still listed, and impact_query works when @chroma-core/default-embed is absent
- All 10 tests pass; no regressions in existing `mcp-server.bats` (5 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create mcp-launch.bats** - `f600dbb` (feat)
2. **Task 2: Create mcp-chromadb-fallback.bats** - `08ccc4f` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `tests/mcp-launch.bats` - 7 bats tests: server starts from plugin root, all 8 tools listed, no ERR_MODULE_NOT_FOUND, no NODE_PATH in .mcp.json, root .mcp.json is empty, tools/call works when DB absent
- `tests/mcp-chromadb-fallback.bats` - 3 bats tests: server starts without @chroma-core/default-embed, all 8 tools still listed, impact_query still works

## Decisions Made

- Used `assert_output --partial 'results'` (without quotes) for the tools/call test because the MCP server wraps results inside a JSON string: `{"content":[{"type":"text","text":"{\"results\":[]}"}]}` — the outer JSON uses escaped quotes, so asserting the plain string `results` is correct.
- The @chroma-core/default-embed package is not installed in the dev repo (it's an optionalDependency). All 3 chromadb-fallback tests pass trivially because the server already operates without it — the rename logic is a no-op. This validates the intent: the server doesn't require the package.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed assert_output to use unquoted 'results' instead of '"results"'**
- **Found during:** Task 1 (mcp-launch.bats verification run)
- **Issue:** Test 7 failed because tools/call response wraps results in escaped JSON inside a text content field: `{"content":[{"type":"text","text":"{\"results\":[]}"}]}` — the assertion `'"results"'` didn't match the escaped form
- **Fix:** Changed `assert_output --partial '"results"'` to `assert_output --partial 'results'` in both test files
- **Files modified:** tests/mcp-launch.bats
- **Verification:** All 7 tests pass after fix
- **Committed in:** f600dbb (Task 1 commit, fixed before commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test assertion)
**Impact on plan:** Minor test assertion fix; no scope creep.

## Issues Encountered

None beyond the assertion fix documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- MCP-01 and MCP-03 requirements verified end-to-end with bats tests
- Phase 60 complete — tests prove the Phase 59 install pipeline works correctly
- Blockers remain from STATE.md: empirical confirmation of CLAUDE_PLUGIN_ROOT writability and SessionStart hook timing

---
*Phase: 060-mcp-server-launch-verification*
*Completed: 2026-03-21*
