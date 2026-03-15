---
phase: 16-mcp-server
plan: 03
subsystem: testing
tags: [mcp, bats, lint, console-log, ci, json-rpc, stdout-pollution]

# Dependency graph
requires:
  - phase: 16-01
    provides: worker/mcp-server.js skeleton, .mcp.json registration, McpServer wired
  - phase: 16-02
    provides: all 5 MCP tools implemented (impact_query, impact_changed, impact_graph, impact_search, impact_scan)
provides:
  - CI lint check in scripts/lint.sh that exits 1 if console.log found in worker/mcp-server.js
  - tests/mcp-server.bats with 5 tests covering lint check, tool names, JSON-RPC protocol, and DB-absent graceful degradation
affects:
  - Phase 17 (CI confidence that MCP server is stdout-clean before HTTP server builds on it)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP stdout-pollution guard: lint.sh checks worker/mcp-server.js for console.log before file-path hook logic — runs unconditionally on every invocation"
    - "Bats JSON-RPC tests use printf to pipe multi-line JSON-RPC messages to node process with timeout 3 and 2>/dev/null stderr suppression"
    - "refute_output --partial used to confirm absence of isError field in DB-absent response"

key-files:
  created:
    - tests/mcp-server.bats
  modified:
    - scripts/lint.sh

key-decisions:
  - "MCP console.log guard placed BEFORE step-4 (file_path check) in lint.sh so it runs even when called without a file argument (e.g., bare bash scripts/lint.sh in CI)"
  - "Guard output (OK/ERROR messages) sent to stderr, which exec 2>/dev/null already silences — prevents any stdout contamination of the hook output"
  - "Bats test 5 asserts 'results' (unquoted) not '\"results\"' because the MCP SDK JSON-encodes the text payload, producing {\\\"results\\\":[]} in the outer JSON string"

patterns-established:
  - "Bats test for MCP JSON-RPC: printf multi-line messages | ALLCLEAR_DB_PATH=nonexistent timeout 3 node worker/mcp-server.js 2>/dev/null"

requirements-completed: [MCPS-01, MCPS-02, MCPS-03, MCPS-04, MCPS-05, MCPS-06, MCPS-07, MCPS-08]

# Metrics
duration: 10min
completed: 2026-03-15
---

# Phase 16 Plan 03: CI Lint Guard and MCP Server Bats Tests Summary

**console.log pollution guard added to scripts/lint.sh (exits 1 on violation) and 5-test bats suite in tests/mcp-server.bats verifies JSON-RPC protocol and DB-absent graceful degradation**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-15T17:35:00Z
- **Completed:** 2026-03-15T17:45:00Z
- **Tasks:** 1 auto + 1 checkpoint (pending human verification)
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- Added MCP stdout-pollution guard to `scripts/lint.sh` — exits 1 with clear error message if `console.log` found in `worker/mcp-server.js`; runs before the per-file hook logic so it catches CI invocations without a file argument
- Created `tests/mcp-server.bats` with 5 tests: lint check passes on clean file, all 5 tool names present, JSON-RPC initialize responds with protocolVersion, tools/list returns impact_query/impact_search, impact_query returns empty results (not error) when DB absent
- All 5 bats tests pass; all 13 existing lint.bats tests unaffected

## Task Commits

Each task was committed atomically:

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 | Add console.log lint guard and mcp-server.bats | `a0cae93` |
| Task 2 | Human verification checkpoint (pending) | — |

## Files Created/Modified

- `scripts/lint.sh` — Added MCP stdout-pollution guard block before step-4 file check
- `tests/mcp-server.bats` — 5-test bats suite for MCP server CI verification

## Decisions Made

- MCP guard placed before the `[[ -z "$FILE" ]]` early-exit so `bash scripts/lint.sh </dev/null` (no file arg) still runs the check
- Guard messages sent to stderr only (stderr already redirected to /dev/null by `exec 2>/dev/null`) — stdout remains clean for hook protocol
- Bats test 5 uses unquoted `results` substring match because MCP SDK wraps tool response text in JSON-encoded string (`{\"results\":[]}`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bats assertion used quoted "results" but MCP response JSON-encodes the payload**
- **Found during:** Task 1 (bats test run verification)
- **Issue:** `assert_output --partial '"results"'` failed because the MCP SDK wraps the tool response text as a JSON-encoded string, producing `{\"results\":[]}` in outer JSON — the literal string `"results"` (with quotes) is not present
- **Fix:** Changed assertion to `assert_output --partial 'results'` (unquoted) which matches the escaped form
- **Files modified:** tests/mcp-server.bats
- **Verification:** All 5 tests pass after fix
- **Committed in:** a0cae93 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test assertion correction)
**Impact on plan:** Minor assertion fix only. No scope creep.

## Checkpoint Pending Human Verification

**Task 2 is a `checkpoint:human-verify` gate** that requires human confirmation. The code work (Task 1) is complete. The following steps remain for human verification:

1. Verify `.mcp.json` exists at project root: `cat .mcp.json`
2. Test lint detection: temporarily add `console.log("test")` to `worker/mcp-server.js`, run `bash scripts/lint.sh`, confirm exit non-zero and ERROR message; then `git checkout worker/mcp-server.js`
3. Run bats suite: `./tests/bats/bin/bats tests/mcp-server.bats` — all 5 tests should pass
4. Verify MCP JSON-RPC tool list: `printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | timeout 3 node worker/mcp-server.js 2>/dev/null`
5. (Optional) In a Claude Code session: confirm allclear-impact appears in the MCP tools panel with all 5 tools

## Issues Encountered

None blocking. One test assertion adjusted for MCP SDK JSON encoding behavior (documented above).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 16 is code-complete. Human verification of Claude Code .mcp.json auto-discovery pending (Task 2 checkpoint)
- Phase 17 (HTTP server / web UI) can proceed — MCP server is lint-clean and bats-verified

---
*Phase: 16-mcp-server*
*Completed: 2026-03-15*
