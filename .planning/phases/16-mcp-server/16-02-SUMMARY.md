---
phase: 16-mcp-server
plan: 02
subsystem: mcp
tags: [mcp, sqlite, better-sqlite3, fts5, impact, graph-traversal, git-diff, tdd]

# Dependency graph
requires:
  - phase: 16-01
    provides: worker/mcp-server.js skeleton with openDb() helper, McpServer wired, all deps installed
  - phase: 14-storage-foundation
    provides: SQLite impact-map.db schema (services, connections, connections_fts tables)
provides:
  - All 5 MCP tools registered: impact_query, impact_changed, impact_graph, impact_search, impact_scan
  - queryImpact, queryChanged, queryGraph, querySearch, queryScan exported for unit testing
  - TDD test suites: worker/mcp-server.test.js (14 tests) + worker/mcp-server-search.test.js (8 tests)
affects:
  - 16-03 (CI lint and bats tests — all 5 tools now present for verification)
  - 17-http-server-web-ui (impact_graph nodes/edges shape aligns with D3 visualization needs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recursive CTE with depth limit 10 and cycle detection via path string for transitive impact traversal"
    - "FTS5 MATCH query with graceful fallback to SQL LIKE when connections_fts table absent"
    - "AbortController for 2-second fetch timeout on worker readiness check"
    - "Pure query functions (queryImpact etc.) exported separately from MCP tool registrations — enables unit testing without MCP SDK"
    - "git diff --name-only HEAD + --cached merged via Set for complete working-tree change detection"

key-files:
  created:
    - worker/mcp-server.test.js
    - worker/mcp-server-search.test.js
  modified:
    - worker/mcp-server.js

key-decisions:
  - "Pure query functions (queryImpact, queryChanged, queryGraph, querySearch, queryScan) exported as named exports — allows unit tests to bypass MCP SDK layer and test with in-memory SQLite"
  - "FTS5 error catch checks for 'no such table: connections_fts' specifically — falls back to SQL LIKE without surfacing the error to callers"
  - "impact_graph returns only connected nodes (not the root service itself) so callers receive the neighbourhood not a self-referential graph"
  - "queryScan reads port from .allclear/worker.port relative to CWD — consistent with Phase 15 DATA_DIR convention"

patterns-established:
  - "TDD test files split per plan task (mcp-server.test.js vs mcp-server-search.test.js) — avoids import errors when Task 2 exports don't exist yet during Task 1 RED phase"

requirements-completed: [MCPS-02, MCPS-03, MCPS-04, MCPS-05, MCPS-06]

# Metrics
duration: 16min
completed: 2026-03-15
---

# Phase 16 Plan 02: MCP Tools Implementation Summary

**All five MCP tools (impact_query, impact_changed, impact_graph, impact_search, impact_scan) implemented in worker/mcp-server.js with TDD test coverage; each tool returns empty results (not errors) when the DB is absent**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-15T17:14:37Z
- **Completed:** 2026-03-15T17:31:13Z
- **Tasks:** 2
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments

- Implemented `queryImpact` with recursive CTE for transitive traversal (cycle-safe, depth limit 10), both `consumes` and `exposes` directions
- Implemented `queryChanged` using `git diff --name-only HEAD` + `--cached` merged via Set, maps changed files to affected services via `source_file`/`target_file` LIKE queries
- Implemented `queryGraph` with upstream/downstream/both direction traversal; returns nodes `{id, name, language}` and edges `{source, target, protocol, method, path}`
- Implemented `querySearch` with FTS5 MATCH query and SQL LIKE fallback; `search_mode` field in response indicates which path was taken
- Implemented `queryScan` with `worker.port` file check, 2-second AbortController readiness probe, and POST to `/scan` — always returns `{status, message}`, never throws
- Registered all 5 tools via `server.tool()` before `server.connect()`; zero `console.log()` calls in file
- TDD RED/GREEN cycle followed: 14 tests for Task 1 tools, 8 tests for Task 2 tools (22 total, all passing)

## Task Commits

Each task was committed atomically:

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 RED | Failing tests for impact_query, impact_changed, impact_graph | `2bff88a` |
| Task 1 GREEN | Implement impact_query, impact_changed, impact_graph | `12cc28c` |
| Task 2 RED | Failing tests for impact_search and impact_scan | `1ae4446` |
| Task 2 GREEN | Implement impact_search and impact_scan | `ae7d3fc` |

## Files Created/Modified

- `worker/mcp-server.js` — Added queryImpact, queryChanged, queryGraph, querySearch, queryScan functions + all 5 server.tool() registrations
- `worker/mcp-server.test.js` — 14 unit tests for impact_query, impact_changed, impact_graph (uses in-memory SQLite)
- `worker/mcp-server-search.test.js` — 8 unit tests for impact_search and impact_scan

## Decisions Made

- Pure query functions exported as named exports to decouple query logic from MCP SDK — enables unit testing with in-memory DB without spawning an MCP server process
- FTS5 fallback catches the specific SQLite error `no such table: connections_fts` rather than a generic catch — avoids masking real query errors
- TDD test files split by task to avoid import errors when Task 2 exports don't exist during Task 1 RED phase

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FTS5 test used wrong query token**
- **Found during:** Task 2 GREEN phase
- **Issue:** Test used `query: 'payment'` but FTS5 token-matches exact words; the path `/payments/charge` tokenizes to `payments` not `payment`
- **Fix:** Updated test to use `query: 'payments'` — the correct token present in the seeded connection path
- **Files modified:** worker/mcp-server-search.test.js
- **Commit:** ae7d3fc (included in same task commit)

## Issues Encountered

None blocking. One test correction needed for FTS5 token matching semantics (documented above).

## User Setup Required

None.

## Next Phase Readiness

- Phase 16 Plan 03 (16-03) can now lint and bats-test all 5 tools
- `grep -c "server.tool" worker/mcp-server.js` returns 5 — ready for CI verification
- All exported functions (queryImpact etc.) are available for integration tests

---
*Phase: 16-mcp-server*
*Completed: 2026-03-15*

## Self-Check: PASSED

- worker/mcp-server.js: FOUND
- worker/mcp-server.test.js: FOUND
- worker/mcp-server-search.test.js: FOUND
- .planning/phases/16-mcp-server/16-02-SUMMARY.md: FOUND
- Commit 2bff88a (test - Task 1 RED): FOUND
- Commit 12cc28c (feat - Task 1 GREEN): FOUND
- Commit 1ae4446 (test - Task 2 RED): FOUND
- Commit ae7d3fc (feat - Task 2 GREEN): FOUND
