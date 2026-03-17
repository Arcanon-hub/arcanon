---
phase: 31-api-surface-extension
verified: 2026-03-17T00:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 31: API Surface Extension Verification Report

**Phase Goal:** The `/graph` HTTP response includes `exposes` arrays on each node and the browser graph state exposes them for click-time panel rendering
**Verified:** 2026-03-17
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /graph response includes exposes array on every service node | VERIFIED | `getGraph()` in `worker/db/query-engine.js` lines 618-636 queries `exposed_endpoints`, groups by `exposesByServiceId`, and attaches `svc.exposes` to every service. Tests 1-4 in `api-surface.test.js` confirm. |
| 2 | Nodes with no stored endpoints have `exposes: []` (not undefined or absent) | VERIFIED | `exposesByServiceId[svc.id] \|\| []` on line 629 guarantees the empty-array default. Test 2 confirms: node with no rows returns `[]` not `undefined`. |
| 3 | `state.graphData.nodes[i].exposes` is populated after `loadProject()` | VERIFIED | `worker/ui/graph.js` line 65: `exposes: s.exposes \|\| [],` in the node mapping object. Both source-analysis tests in `graph-exposes.test.js` confirm `s.exposes` is present and the `\|\| []` guard appears within 50 chars. |
| 4 | Each expose object contains kind, method, path, and handler fields | VERIFIED | SELECT includes `service_id, method, path, kind, handler` (query-engine.js line 621). Test 1 asserts `health.method`, `health.kind`, `health.handler`, `health.service_id`. |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `worker/db/query-engine.js` | `getGraph()` with exposes attachment via `exposesByServiceId` | VERIFIED | Lines 618-636 implement the try/catch grouped attachment. Pattern `exposesByServiceId` confirmed present. |
| `worker/ui/graph.js` | `loadProject()` forwarding `s.exposes \|\| []` to state nodes | VERIFIED | Line 65: `exposes: s.exposes \|\| [],` in the node mapping return object. |
| `tests/storage/api-surface.test.js` | Unit tests for `getGraph()` exposes shape (4 tests) | VERIFIED | File exists, 225 lines, 4 substantive tests covering populated array, empty array, pre-migration degradation, and multi-service grouping. All 4 pass. |
| `tests/ui/graph-exposes.test.js` | Source-analysis tests for `loadProject()` exposes mapping | VERIFIED | File exists, 39 lines, 2 tests asserting `s.exposes` presence and `\|\| []` guard. Both pass. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `worker/db/query-engine.js` | `exposed_endpoints` table | `SELECT service_id, method, path, kind, handler FROM exposed_endpoints` | WIRED | Exact SELECT confirmed at line 621. Grouped into `exposesByServiceId` map, attached to all service nodes. |
| `worker/ui/graph.js` | `worker/db/query-engine.js` (via `/graph` API) | `loadProject()` maps `s.exposes \|\| []` from `getGraph()` response | WIRED | `graph.js` line 65 maps `exposes: s.exposes \|\| []` inside the `.map((s) => {...})` block (lines 57-67). No intermediate fetch — uses `raw.services` already populated from GET /graph. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| API-01 | 31-01-PLAN.md | `getGraph()` response includes `exposes` array on each service node containing its exposed endpoints/exports/resources | SATISFIED | `getGraph()` attaches `exposes` to every service node; shape `{service_id, method, path, kind, handler}` confirmed by Test 1. |
| API-02 | 31-01-PLAN.md | `graph.js` `loadProject()` forwards exposes data into `state.graphData.nodes[i].exposes` | SATISFIED | `graph.js` line 65 maps `exposes: s.exposes \|\| []`; source-analysis tests confirm the property exists in the mapping object. |

No orphaned requirements: REQUIREMENTS.md traceability table maps only API-01 and API-02 to Phase 31. Both are accounted for.

---

### Anti-Patterns Found

None. Scanned `worker/db/query-engine.js`, `worker/ui/graph.js`, `tests/storage/api-surface.test.js`, and `tests/ui/graph-exposes.test.js` for TODO/FIXME/placeholder comments, empty return values, and stub handlers. No issues found.

---

### Test Results

```
23 tests, 0 failures, 0 skipped

  getGraph() exposes attachment (api-surface.test.js)
    Test 1: returns exposes array on service nodes that have exposed_endpoints rows   PASS
    Test 2: returns exposes: [] for service nodes with no exposed_endpoints rows       PASS
    Test 3: returns exposes: [] for all nodes when migration 007 has not run           PASS
    Test 4: multiple services each get their own correct exposes arrays                PASS

  graph.js loadProject maps exposes from API response (graph-exposes.test.js)         PASS
  graph.js loadProject defaults exposes to empty array (graph-exposes.test.js)        PASS

  All existing query-engine.test.js tests (17 tests)                                  PASS
```

Commits verified in git history:
- `56f76cd` — feat(31-01): extend getGraph() to attach exposes arrays from exposed_endpoints
- `f6ae655` — feat(31-01): forward exposes through loadProject() into state.graphData.nodes

---

### Human Verification Required

None. All truths are verifiable programmatically. The one item that could benefit from a live check — confirming `state.graphData.nodes[i].exposes` is populated after `loadProject()` in a real browser — is fully covered by the source-analysis tests and the data-flow wiring confirmed here.

---

### Summary

Phase 31 fully achieves its goal. `getGraph()` queries `exposed_endpoints`, groups rows by service, and attaches a populated or empty `exposes` array to every node in the graph response. `loadProject()` in `graph.js` maps `s.exposes || []` into `state.graphData.nodes`, ensuring Phase 32 detail panels have endpoint data available at click time without a secondary fetch. Both requirements API-01 and API-02 are satisfied with no gaps, no stubs, and no regressions.

---

_Verified: 2026-03-17_
_Verifier: Claude (gsd-verifier)_
