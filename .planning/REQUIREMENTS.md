# Requirements: Ligamen

**Defined:** 2026-03-21
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.1 Requirements

Requirements for Graph Interactivity milestone. Each maps to roadmap phases.

### Navigation

- [x] **NAV-01**: User can press F to fit all nodes to screen
- [x] **NAV-02**: User can press Esc to deselect current node and close detail panel
- [x] **NAV-03**: User can press / to focus the search input
- [x] **NAV-04**: User can click a service name in the detail panel connections list to select and pan to that node
- [ ] **NAV-05**: User can press I on a selected node to isolate its subgraph (1-hop default)
- [ ] **NAV-06**: User can press 2/3 to expand isolation to 2-hop or 3-hop depth

### Graph Display

- [ ] **GRAPH-01**: Parallel edges between the same source→target pair are bundled into a single thick edge with count badge
- [ ] **GRAPH-02**: User can click a bundled edge to expand individual connections in the detail panel
- [ ] **GRAPH-03**: Nodes and edges from the latest scan are visually highlighted (glow or "NEW" badge)
- [ ] **GRAPH-04**: /graph API endpoint includes scan_version_id per service and connection

### Export

- [x] **EXP-01**: User can click an export button to download the current canvas view as PNG

### Documentation

- [ ] **DOC-01**: README updated with v5.1 feature descriptions and keyboard shortcut reference
- [ ] **DOC-02**: docs/commands.md updated with new graph UI capabilities

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Context Menu

- **CTX-01**: User can right-click a node to access actions (copy name, show blast, open repo)
- **CTX-02**: Context menu adapts options based on node type (service vs library vs infra)

### Advanced Visualization

- **VIZ-01**: Minimap overview showing full graph with viewport indicator
- **VIZ-02**: On-canvas legend showing node shape → type mapping
- **VIZ-03**: Zoom level indicator with reset-to-100% click
- **VIZ-04**: URL state persistence for bookmarkable views (zoom, position, filters, selected node)

## Out of Scope

| Feature | Reason |
|---------|--------|
| SVG export | Canvas-to-SVG re-rendering is high effort; PNG covers the use case |
| Touch/mobile support | Single-developer desktop tool |
| Accessibility (WCAG) | Single-developer tool; not public-facing |
| Edge labels on hover | Adds rendering complexity; detail panel already shows edge info on click |
| Graph diff endpoint | Full diff API is over-engineered; scan_version_id comparison is sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| NAV-01 | Phase 52 | Complete |
| NAV-02 | Phase 52 | Complete |
| NAV-03 | Phase 52 | Complete |
| NAV-04 | Phase 53 | Complete |
| NAV-05 | Phase 54 | Pending |
| NAV-06 | Phase 54 | Pending |
| GRAPH-01 | Phase 57 | Pending |
| GRAPH-02 | Phase 57 | Pending |
| GRAPH-03 | Phase 56 | Pending |
| GRAPH-04 | Phase 55 | Pending |
| EXP-01 | Phase 52 | Complete |
| DOC-01 | Phase 58 | Pending |
| DOC-02 | Phase 58 | Pending |

**Coverage:**
- v5.1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after roadmap creation (phases 52-58)*
