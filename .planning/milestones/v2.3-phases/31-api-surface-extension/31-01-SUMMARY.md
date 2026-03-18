---
phase: 31-api-surface-extension
plan: "01"
subsystem: storage-api
tags: [api, graph, exposes, sqlite, tdd]
dependency_graph:
  requires: [30-storage-correctness]
  provides: [exposes-in-graph-response, exposes-in-state-nodes]
  affects: [worker/db/query-engine.js, worker/ui/graph.js]
tech_stack:
  added: []
  patterns: [try-catch-migration-guard, exposesByServiceId-grouping, source-analysis-tests]
key_files:
  created:
    - tests/storage/api-surface.test.js
    - tests/ui/graph-exposes.test.js
  modified:
    - worker/db/query-engine.js
    - worker/ui/graph.js
    - tests/storage/query-engine.test.js
decisions:
  - "SELECT kind in exposed_endpoints query now (migration 007 column) so Phase 32 detail panels get all fields without another query change"
  - "try/catch guard on exposed_endpoints SELECT mirrors detectMismatches() pattern — returns exposes:[] when migration 007 not applied"
  - "|| [] guard in loadProject() node mapping ensures state nodes always have exposes array, never undefined"
metrics:
  duration: 2min
  completed_date: "2026-03-17"
  tasks: 2
  files_changed: 5
---

# Phase 31 Plan 01: API Surface Extension Summary

**One-liner:** Extended `/graph` response and browser state to include per-node `exposes` arrays from `exposed_endpoints`, with `kind/method/path/handler` fields and graceful pre-migration degradation.

## What Was Built

`getGraph()` in `worker/db/query-engine.js` now queries `exposed_endpoints` after fetching services, groups rows by `exposesByServiceId`, and attaches the array to each `svc.exposes`. A try/catch guard returns `exposes: []` on all nodes when migration 007 (kind column) has not been applied. `loadProject()` in `worker/ui/graph.js` maps `s.exposes || []` into `state.graphData.nodes`, ensuring Phase 32 detail panels have endpoint data available at click time without a secondary fetch.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Extend getGraph() to attach exposes arrays | 56f76cd | worker/db/query-engine.js, tests/storage/api-surface.test.js, tests/storage/query-engine.test.js |
| 2 | Forward exposes through loadProject() into state.graphData.nodes | f6ae655 | worker/ui/graph.js, tests/ui/graph-exposes.test.js |

## Verification

All success criteria met:

1. `getGraph()` includes `exposes` array on every service node with `{service_id, method, path, kind, handler}` objects — Test 1 confirms.
2. Nodes with no stored endpoints have `exposes: []` — Test 2 confirms.
3. `state.graphData.nodes[i].exposes` is populated after `loadProject()` with `|| []` default — graph-exposes tests confirm.
4. All new tests pass: 4 api-surface tests + 2 graph-exposes tests = 6 tests, all green.
5. Existing tests unbroken: query-engine.test.js 17 tests all pass (including after adding migration 006 to makeQE chain).

Total: 23/23 tests passing.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files exist:
- tests/storage/api-surface.test.js: FOUND
- tests/ui/graph-exposes.test.js: FOUND
- worker/db/query-engine.js (modified): FOUND
- worker/ui/graph.js (modified): FOUND

Commits exist:
- 56f76cd: FOUND (feat(31-01): extend getGraph()...)
- f6ae655: FOUND (feat(31-01): forward exposes through loadProject()...)
