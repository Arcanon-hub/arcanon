---
phase: 32-ui-detail-panels
plan: "02"
subsystem: ui
tags: [detail-panel, library, infra, xss, routing]
dependency_graph:
  requires:
    - 32-01  # infra guard in getNodeType() and utils.test.js
  provides:
    - three-way panel dispatch (infra/library/service)
    - library exports renderer with function/type grouping
    - infra resources renderer with prefix grouping
    - escapeHtml helper for XSS safety
  affects:
    - worker/ui/modules/detail-panel.js
tech_stack:
  added: []
  patterns:
    - Source-inspection tests via readFileSync (same pattern as interactions.test.js)
    - HTML escaping via String.replace chains before innerHTML insertion
    - Prefix grouping via Array.split('/')[0] + Object.entries()
key_files:
  created:
    - worker/ui/modules/detail-panel.test.js
  modified:
    - worker/ui/modules/detail-panel.js
decisions:
  - escapeHtml applied to ALL user-controlled strings in new renderers (node.exposes paths, service names, source_file) to address XSS concern from STATE.md
  - Library Exports section replaces old Provides section — actual export surface from node.exposes is more useful than outgoing edge list
  - No-connections guard updated to check node.exposes length — prevents false "No connections" on nodes with exposes but no edges
metrics:
  duration: "2min"
  completed_date: "2026-03-17"
  tasks_completed: 2
  files_changed: 2
---

# Phase 32 Plan 02: Three-Way Detail Panel Routing Summary

Three-way panel dispatch (infra/library/service) with library exports grouped by functions vs types and infra resources grouped by path prefix, plus escapeHtml XSS safety on all user-controlled strings.

## What Was Built

**detail-panel.js:**
- `escapeHtml(str)` helper added before `showDetailPanel()` — replaces `&`, `<`, `>` with HTML entities
- `isLib` two-way boolean replaced with three-way `if/else if/else` block dispatching to `renderInfraConnections`, `renderLibraryConnections`, or `renderServiceConnections` based on `nodeType`
- `renderLibraryConnections(node, outgoing, incoming, nameById)` — new 4-arg signature; renders Exports section filtered from `node.exposes` by `kind === 'export'`, split into Functions (path contains `(`) and Types (path does not), followed by Used by section with dedup-by-name Set
- `renderInfraConnections(node, outgoing, nameById)` — new function; renders Manages section filtered by `kind === 'resource'` grouped by `r.path.split('/')[0]` prefix, followed by Wires section for outgoing edges
- No-connections guard updated: `outgoing.length === 0 && incoming.length === 0 && (node.exposes || []).length === 0`
- `renderServiceConnections()` — untouched

**detail-panel.test.js:**
- 11 source-inspection checks covering PANEL-02, PANEL-03, PANEL-04, XSS safety, and no-connections guard

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create detail-panel.test.js (RED) | eac98ad |
| 2 | Implement three-way routing, renderers, escapeHtml (GREEN) | 1e610a3 |

## Verification

- `node worker/ui/modules/detail-panel.test.js` — 11 passed, 0 failed
- `node worker/ui/modules/utils.test.js` — 4 passed, 0 failed (no regression)
- `const isLib` not present in source
- `renderServiceConnections()` source unchanged

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- worker/ui/modules/detail-panel.test.js: FOUND
- worker/ui/modules/detail-panel.js: FOUND
- Commit eac98ad: FOUND
- Commit 1e610a3: FOUND
