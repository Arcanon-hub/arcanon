# Requirements: AllClear v2.3

**Defined:** 2026-03-17
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v2.3 Requirements

Requirements for type-specific detail panels. Each maps to roadmap phases.

### Storage Correctness

- [x] **STORE-01**: Migration 007 adds `kind` column to `exposed_endpoints` table with type-conditional values (endpoint, export, resource)
- [x] **STORE-02**: Migration 007 purges malformed `exposed_endpoints` rows for non-service nodes so re-scan inserts correctly
- [x] **STORE-03**: `persistFindings()` uses type-conditional parsing — services parse "METHOD PATH", libraries store raw signature text, infra stores raw resource reference

### API Surface

- [ ] **API-01**: `getGraph()` response includes `exposes` array on each service node containing its exposed endpoints/exports/resources
- [ ] **API-02**: `graph.js` `loadProject()` forwards exposes data into `state.graphData.nodes[i].exposes`

### Detail Panels

- [ ] **PANEL-01**: `getNodeType()` in `utils.js` recognizes `infra` type and returns correct classification
- [ ] **PANEL-02**: `showDetailPanel()` dispatch routes infra nodes to an infra-specific renderer instead of falling through to service renderer
- [ ] **PANEL-03**: Library detail panel shows exported types/interfaces grouped by category (functions vs types) and lists which services consume the library
- [ ] **PANEL-04**: Infra detail panel shows managed resources grouped by prefix (k8s:deployment, k8s:configmap, etc.) and lists which services are provisioned by this infra

## Future Requirements

### Extended Type Intelligence

- **TYPE-01**: Mismatch detection extended to library/infra types (version mismatches between declared and consumed exports)
- **TYPE-02**: Inline code navigation from detail panel to source file references

## Out of Scope

| Feature | Reason |
|---------|--------|
| New API routes for per-service exposes | Embedding in /graph response is simpler and matches existing single-load pattern |
| Renaming exposed_endpoints table | Adds migration complexity for cosmetic benefit; `kind` column is sufficient |
| boundary_entry column | Deferred — useful but not required for detail panel MVP |
| Mismatch detection for lib/infra | Different semantics (version mismatch vs endpoint mismatch); defer to future milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STORE-01 | Phase 30 | Complete |
| STORE-02 | Phase 30 | Complete |
| STORE-03 | Phase 30 | Complete |
| API-01 | Phase 31 | Pending |
| API-02 | Phase 31 | Pending |
| PANEL-01 | Phase 32 | Pending |
| PANEL-02 | Phase 32 | Pending |
| PANEL-03 | Phase 32 | Pending |
| PANEL-04 | Phase 32 | Pending |

**Coverage:**
- v2.3 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 after roadmap creation (all 9 requirements mapped)*
