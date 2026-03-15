---
phase: 17-http-server-web-ui
plan: "01"
subsystem: api
tags: [fastify, http-server, rest-api, esm, tdd]

# Dependency graph
requires:
  - phase: 14-storage-foundation
    provides: "SQLite schema and query-engine interface"
  - phase: 15-worker-lifecycle
    provides: "worker process management and port binding"
  - phase: 16-mcp-server
    provides: "package.json with all v2 dependencies"
provides:
  - "Fastify HTTP server factory createHttpServer(queryEngine, options)"
  - "6 REST routes: /api/readiness, /graph, /impact, /service/:name, /scan, /versions"
  - "Static file serving from worker/ui/ at root path /"
  - "Null queryEngine guard returning 503 on all data routes"
affects: [18-agent-scanning, 19-web-ui, 20-command-layer]

# Tech tracking
tech-stack:
  added: [fastify@5, "@fastify/static@8", "@fastify/cors@10"]
  patterns: ["Fastify inject() for unit tests (no real TCP)", "null queryEngine guard returning 503", "readiness route registered first"]

key-files:
  created:
    - worker/http-server.js
    - worker/http-server.test.js
    - worker/ui/.gitkeep
  modified:
    - package.json

key-decisions:
  - "Server binds to 127.0.0.1 only — never 0.0.0.0 — for security"
  - "Port 0 in tests triggers fastify.ready() instead of listen() for inject-only testing"
  - "Readiness route registered as absolute first route — readiness probe must not be blocked by any data init"
  - "queryEngine null check on all data routes returns 503 not 500 — expected transient state before DB ready"
  - "logger: false on Fastify instance — no stdout pollution from worker process"

patterns-established:
  - "Fastify route handler pattern: null queryEngine check -> try/catch -> reply.send()"
  - "TDD with Node built-in test module and fastify.inject() — no external test framework"

requirements-completed: [HTTP-01, HTTP-02, HTTP-03, HTTP-04, HTTP-05, HTTP-06]

# Metrics
duration: 10min
completed: 2026-03-15
---

# Phase 17 Plan 01: HTTP Server Summary

**Fastify 5 HTTP server with 6 REST routes, 127.0.0.1-only binding, and null queryEngine 503 guard — fully TDD'd with Node built-in test module and inject() API**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-15T17:06:00Z
- **Completed:** 2026-03-15T17:08:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Fastify HTTP server factory (`createHttpServer`) with all 6 REST routes registered in the required order
- `/api/readiness` registered first and always returns 200 regardless of queryEngine state
- All data routes (`/graph`, `/impact`, `/service/:name`, `/versions`) guard against null queryEngine with 503
- Server binds exclusively to `127.0.0.1` — verified via `server.address().address`
- 13 unit tests passing with `node --test` using `fastify.inject()` — no real TCP socket needed

## Task Commits

Each task was committed atomically:

1. **Task 1: Add v2 worker dependencies to package.json** — already present from commit `19df43e` (chore 16-01)
2. **Task 2 TDD RED: Failing test suite** — `1a65602` (test)
3. **Task 2 TDD GREEN: Implement http-server.js** — `dec9c1f` (feat)

_Note: TDD task has two commits (test → feat)._

## Files Created/Modified

- `worker/http-server.js` — Fastify server factory, all 6 REST routes, static serving, 127.0.0.1 binding
- `worker/http-server.test.js` — 13 unit tests covering all routes and null queryEngine behavior
- `worker/ui/.gitkeep` — Placeholder for static file directory (Phase 19 will populate)
- `package.json` — Already had all v2 dependencies from Phase 16 plan 01

## Decisions Made

- **Port 0 for testing:** When `options.port === 0`, calls `fastify.ready()` instead of `fastify.listen()`. This enables `inject()` testing without binding a real port and avoids port conflicts.
- **127.0.0.1 binding:** Hard-coded host string in `fastify.listen({ host: '127.0.0.1' })` — not configurable — ensures the worker is never accidentally exposed on all interfaces.
- **logger: false:** No stdout logging from Fastify. The worker process stdout is reserved for structured protocol output; Fastify logs would corrupt it.
- **@fastify/cors:** Registered with origin whitelist for localhost:5173 (Vite dev server) and any 127.0.0.1 port. Production deployments can tighten this.

## Deviations from Plan

None — plan executed exactly as written.

Task 1 (package.json) was already completed in Phase 16 Plan 01 (`19df43e`). The package.json already had all required dependencies including `optionalDependencies`. Only the `optionalDependencies` section was confirmed present.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- HTTP server is complete and tested. Phase 18 (agent scanning) can now implement `POST /scan` logic by calling through to the scan manager.
- Phase 19 (Web UI) can serve static files from `worker/ui/` immediately — the static route is already registered.
- `worker/query-engine.js` is not yet implemented (Phase 14). The 503 guard in http-server.js handles this gracefully.

---
*Phase: 17-http-server-web-ui*
*Completed: 2026-03-15*

## Self-Check: PASSED

- worker/http-server.js: FOUND
- worker/http-server.test.js: FOUND
- worker/ui/.gitkeep: FOUND
- .planning/phases/17-http-server-web-ui/17-01-SUMMARY.md: FOUND
- Commit 1a65602 (TDD RED): FOUND
- Commit dec9c1f (TDD GREEN): FOUND
