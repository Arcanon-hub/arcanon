# Requirements: AllClear v2.1

**Defined:** 2026-03-16
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v2.1 Requirements

Requirements for UI polish and observability release. Each maps to roadmap phases.

### Canvas Rendering

- [x] **CANVAS-01**: Graph renders at native resolution on HiDPI/Retina displays (devicePixelRatio scaling)
- [x] **CANVAS-02**: Node labels, tooltips, and detail panel text use larger, readable font sizes

### Zoom & Pan

- [x] **ZOOM-01**: Zoom sensitivity is reduced for smooth, controllable zoom on mouse wheel and trackpad
- [x] **ZOOM-02**: Pinch gesture zooms while two-finger scroll pans (ctrlKey detection)
- [x] **ZOOM-03**: User can click a fit-to-screen button to reset view to show all nodes centered

### Project Switcher

- [ ] **PROJ-01**: User can switch between projects via a persistent dropdown without page reload

### Logging Instrumentation

- [x] **LOG-INFRA-01**: All worker components use a shared structured logger instead of console.log/console.error
- [x] **LOG-INFRA-02**: Every log line includes a `component` field (worker, http, mcp, scan)
- [x] **LOG-INFRA-03**: No console.log/console.error calls remain in production worker code

### Log Terminal

- [ ] **LOG-01**: User can open a collapsible bottom panel showing real-time worker logs (collapsed by default)
- [ ] **LOG-02**: User can filter logs by component (scan, MCP, worker, HTTP)
- [ ] **LOG-03**: User can search logs by keyword
- [ ] **LOG-04**: Log panel auto-scrolls to latest entry and pauses when user scrolls up manually

## Future Requirements

### Project Switcher Enhancements

- **PROJ-02**: Remember last-selected project in localStorage across sessions

### Log Terminal Enhancements

- **LOG-05**: Log rotation support for long-running worker instances
- **LOG-06**: Export visible logs to file

### Scan Data Integrity (BUG)

- **SCAN-01**: Re-scanning a repo upserts services by (repo_id, name) instead of creating duplicates
- **SCAN-02**: Cross-repo service identity — same service name from different repos merges into one graph node
- **SCAN-03**: Each scan creates a versioned snapshot; graph shows latest version; UI can browse scan history
- **SCAN-04**: Agent prompt enforces consistent service naming (no event-journal vs event_journal drift)

## Out of Scope

| Feature | Reason |
|---------|--------|
| xterm.js interactive terminal | This is a log viewer, not a shell — styled div is sufficient and avoids 300KB dep |
| Log persistence across worker restarts | Worker already writes to file; UI streams from file, no additional persistence needed |
| Multi-project log aggregation | v2.1 shows logs for the single running worker instance |
| Graph layout algorithms beyond D3 force | D3 force is working; layout improvements are a separate milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CANVAS-01 | Phase 22 | Complete |
| CANVAS-02 | Phase 22 | Complete |
| ZOOM-01 | Phase 22 | Complete |
| ZOOM-02 | Phase 22 | Complete |
| ZOOM-03 | Phase 22 | Complete |
| LOG-INFRA-01 | Phase 23 | Complete |
| LOG-INFRA-02 | Phase 23 | Complete |
| LOG-INFRA-03 | Phase 23 | Complete |
| LOG-01 | Phase 25 | Pending |
| LOG-02 | Phase 25 | Pending |
| LOG-03 | Phase 25 | Pending |
| LOG-04 | Phase 25 | Pending |
| PROJ-01 | Phase 26 | Pending |

**Coverage:**
- v2.1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

**Note:** Phase 24 (Log Terminal API) is an infrastructure phase with no direct REQUIREMENTS.md items. It delivers the server-side endpoint that Phase 25 depends on. All LOG requirements map to Phase 25 where the user-visible outcome is achieved.

---
*Requirements defined: 2026-03-16*
*Last updated: 2026-03-16 — traceability mapped after roadmap creation*
