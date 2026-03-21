---
phase: 57-edge-bundling
plan: "02"
subsystem: graph-ui
tags: [edge-bundling, hit-testing, detail-panel, interactions]
dependency_graph:
  requires: [57-01]
  provides: [bundle-click-detail]
  affects: [graph-canvas-interactions, detail-panel]
tech_stack:
  added: []
  patterns: [point-to-segment-distance, click-priority-chain]
key_files:
  created: []
  modified:
    - plugins/ligamen/worker/ui/modules/utils.js
    - plugins/ligamen/worker/ui/modules/interactions.js
    - plugins/ligamen/worker/ui/modules/detail-panel.js
decisions:
  - "edgeHitTest placed after computeEdgeBundles in utils.js — natural adjacency, same data"
  - "HIT_RADIUS=10 logical pixels — same coordinate space as computeEdgeBundles, independent of zoom"
  - "showBundlePanel placed before hideDetailPanel in detail-panel.js — maintains panel export cluster"
  - "onClick else-branch uses nested if/else so hideDetailPanel only fires when neither node nor bundle was hit"
metrics:
  duration_seconds: 57
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
  completed_date: "2026-03-21"
---

# Phase 57 Plan 02: Bundle Hit Testing and Detail Panel Summary

**One-liner:** Click-to-expand bundled edges using point-to-segment distance hit test (10px tolerance, count > 1 only) with per-connection detail panel showing protocol, method, path, and mismatch flag.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add edgeHitTest to utils.js | 0432d07 | utils.js |
| 2 | Wire edgeHitTest into onClick and add showBundlePanel | 758716b | interactions.js, detail-panel.js |

## What Was Built

**edgeHitTest(px, py)** in `utils.js`:
- Converts canvas pixel coords to world coords via `toWorld`
- Rebuilds filtered bundles per click (same activeProtocols + mismatchesOnly filter as renderer)
- Tests only bundles with `count > 1` — single edges remain non-clickable
- Uses point-to-segment projection with 10px logical-pixel tolerance

**onClick update** in `interactions.js`:
- After node hit test fails, calls `edgeHitTest(e.offsetX, e.offsetY)`
- If a bundle is hit: deselects any node, calls `showBundlePanel(bundle)`
- If nothing hit: calls `hideDetailPanel()` (unchanged behavior)
- Node selection still takes priority — `hitTest` runs before `edgeHitTest`

**showBundlePanel(bundle)** in `detail-panel.js`:
- Renders `source → target` header using node name lookup from `state.graphData.nodes`
- Shows "Bundled connections (N)" section header
- Lists each individual edge with method/protocol, path, and mismatch indicator
- Mismatch edges get red left border + warning text (consistent with node detail panel styling)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files verified:
- `plugins/ligamen/worker/ui/modules/utils.js` — exports `edgeHitTest`, calls `computeEdgeBundles`, filters `count > 1`
- `plugins/ligamen/worker/ui/modules/interactions.js` — imports and calls `edgeHitTest`, imports and calls `showBundlePanel`
- `plugins/ligamen/worker/ui/modules/detail-panel.js` — exports `showBundlePanel`, references `bundle.edges` and `bundle.count`

Commits verified:
- `0432d07` feat(57-02): add edgeHitTest to utils.js
- `758716b` feat(57-02): wire edgeHitTest into onClick and add showBundlePanel
