---
phase: 29-cross-project-mcp-queries
plan: 01
subsystem: database
tags: [sqlite, mcp, pool, per-call-resolution, cross-project]

# Dependency graph
requires:
  - phase: 27-schema-foundation-upsert-repair
    provides: migration 004_dedup_constraints, UNIQUE(repo_id, name) constraint on services
  - phase: 28-scan-versions
    provides: migration 005_scan_versions, scan_version_id FK columns on services/connections
provides:
  - getQueryEngineByRepo(repoName) in pool.js — cross-project DB lookup by repo name
  - resolveDb(project) in mcp/server.js — per-call QueryEngine resolution for all 5 MCP tools
  - Optional project param on all 4 DB-using MCP tools (impact_query, impact_changed, impact_graph, impact_search)
  - Structured error { error: "no_scan_data", hint } for unknown project identifiers
affects:
  - any MCP client agent performing cross-project impact queries
  - impact graph UI (uses getQueryEngineByHash which now has correct TODO comment)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-call DB resolution: resolveDb(project) called at handler entry, dispatches to getQueryEngine/getQueryEngineByHash/getQueryEngineByRepo"
    - "Pool-owned connections: tool handlers never call db.close() — pool.js owns connection lifetime"
    - "Structured errors for missing projects: { error, project, hint } instead of silent empty results"

key-files:
  created:
    - worker/db/pool-repo.test.js
  modified:
    - worker/db/pool.js
    - worker/mcp/server.js
    - worker/mcp/server.test.js

key-decisions:
  - "resolveDb routing: absolute path → getQueryEngine; 12-char hex → getQueryEngineByHash; other string → getQueryEngineByRepo; undefined → ALLCLEAR_PROJECT_ROOT / cwd"
  - "getQueryEngineByRepo fallback chain: pool cache first (case-insensitive), then scan all project DBs by hash dir, then getQueryEngineByHash as final fallback opener"
  - "Pre-existing bug fixed in listProjects: db.pragma('journal_mode = WAL') on readonly connection causes SQLITE_READONLY, silently making all project discovery return empty"
  - "Inline migration workaround in getQueryEngineByHash annotated with TODO — both migrations 004 and 005 now exist, safe to remove once all DBs upgraded to v5 via standard openDb() path"
  - "openDb() export preserved in server.js for backward compat — deprecated but not removed"

patterns-established:
  - "Per-call DB resolution pattern: const qe = resolveDb(params.project); if (!qe && params.project) return structured error; pass qe?._db ?? null to query functions"

requirements-completed: [SCAN-05]

# Metrics
duration: 17min
completed: 2026-03-16
---

# Phase 29 Plan 01: Cross-Project MCP Queries Summary

**Per-call resolveDb() in MCP server dispatches to pool.js by path/hash/name, enabling agents in any repo to query any project's impact graph via optional `project` param on all 4 DB tools**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-16T15:04:33Z
- **Completed:** 2026-03-16T15:21:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `getQueryEngineByRepo(repoName)` to pool.js with pool cache check + full DB scan fallback, case-insensitive matching
- Added `resolveDb(project)` to mcp/server.js routing absolute paths, 12-char hex hashes, repo names, and undefined to the correct pool lookup
- Refactored all 4 DB-using tool handlers to use per-call `resolveDb(params.project)` instead of module-level `openDb()`; removed all `db.close()` calls from handlers
- Added optional `project` param to all 4 DB-using tool schemas with structured `{ error: "no_scan_data", hint }` error for unknown projects
- 10 new tests: 4 in pool-repo.test.js, 6 in server.test.js

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getQueryEngineByRepo to pool.js** - `4e76552` (feat)
2. **Task 2: Per-call resolveDb in mcp/server.js** - `30cc8ca` (feat)

## Files Created/Modified
- `worker/db/pool.js` - Added `getQueryEngineByRepo`, fixed pre-existing listProjects WAL pragma bug, updated inline migration TODO
- `worker/db/pool-repo.test.js` - New: 4 integration tests for getQueryEngineByRepo
- `worker/mcp/server.js` - Import pool.js, add resolveDb(), refactor 4 tool handlers, add project param to schemas
- `worker/mcp/server.test.js` - Added 6 resolveDb behavior tests

## Decisions Made
- resolveDb routing: absolute path → getQueryEngine; `/^[0-9a-f]{12}$/` → getQueryEngineByHash; anything else → getQueryEngineByRepo; undefined → ALLCLEAR_PROJECT_ROOT or cwd
- getQueryEngineByRepo fallback: if getQueryEngine(matchedProjectRoot) returns null (database.js hardcodes ~/.allclear path), fall back to getQueryEngineByHash(hash) which opens by direct dbPath
- openDb() kept as deprecated named export in server.js for backward compat with existing tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing WAL pragma on readonly DB in listProjects()**
- **Found during:** Task 1 (getQueryEngineByRepo debugging)
- **Issue:** `listProjects()` called `db.pragma("journal_mode = WAL")` on a `{ readonly: true }` Database connection; better-sqlite3 throws SQLITE_READONLY which was silently caught, making every project scan return empty results
- **Fix:** Removed the `db.pragma("journal_mode = WAL")` call from the readonly open in `listProjects()` and from the same pattern in `getQueryEngineByRepo`
- **Files modified:** worker/db/pool.js
- **Verification:** pool-repo.test.js and listProjects() now return correct results
- **Committed in:** 4e76552 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The WAL pragma bug was silently breaking all project discovery. Fix was essential for getQueryEngineByRepo to work at all. No scope creep.

## Issues Encountered
- ESM module caching during tests: `import('pool.js?t=timestamp')` approach for test isolation worked but revealed that `getQueryEngine` delegates to `database.js#openDb()` which hardcodes `~/.allclear`. Resolved by having `getQueryEngineByRepo` fall back to `getQueryEngineByHash(hash)` which uses the direct dbPath
- Test DB schema needed to include all migration 001-005 columns for QueryEngine constructor to succeed (especially `scan_version_id` from migration 005 and `repo_state` table)

## Next Phase Readiness
- MCP server now fully project-aware: agents can pass `project: "repo-name"` or `project: "/path/to/project"` to any query tool
- pool.js exports: getQueryEngine, getQueryEngineByHash, getQueryEngineByRepo, listProjects
- Inline migration workaround in getQueryEngineByHash is annotated with TODO to remove once all DBs upgraded to schema v5 through standard openDb() path

---
*Phase: 29-cross-project-mcp-queries*
*Completed: 2026-03-16*
