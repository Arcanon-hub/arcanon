# Requirements: AllClear

**Defined:** 2026-03-18
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v3.0 Requirements

Requirements for milestone v3.0 Layered Graph & Intelligence. Each maps to roadmap phases.

### Layout

- [x] **LAYOUT-01**: Graph uses deterministic layered layout with services at top, libraries in middle, infrastructure at bottom
- [x] **LAYOUT-02**: Node positions are stable across page reloads (no force simulation randomness)
- [x] **LAYOUT-03**: Nodes within each layer are algorithmically spaced (grid-based positioning)
- [x] **LAYOUT-04**: Services can be visually grouped into boundary boxes (user-defined in `allclear.config.json`)
- [x] **LAYOUT-05**: Boundary boxes render as dashed rounded rectangles with semi-transparent fill and label

### Node Rendering

- [x] **NODE-01**: Services render as filled circles
- [x] **NODE-02**: Libraries/SDKs render as outline diamonds
- [x] **NODE-03**: Infrastructure nodes render as filled diamonds
- [x] **NODE-04**: External system actors render as hexagons on the right side, outside the system boundary
- [x] **NODE-05**: Hovering a node shows tooltip with type and connection count

### External Actors

- [x] **ACTOR-01**: Outbound external connections from scan are stored as external actor nodes (separate `actors` table)
- [x] **ACTOR-02**: External actors display in a dedicated column to the right of the system boundary
- [x] **ACTOR-03**: Edges from services to external actors cross the system boundary visually
- [x] **ACTOR-04**: Detail panel for external actors shows which services connect to them and via what protocol

### Controls & Filters

- [ ] **CTRL-01**: Top bar shows only Search, Project selector, and Filters button
- [ ] **CTRL-02**: Collapsible filter panel with protocol toggles (REST, gRPC, Events, SDK, Internal)
- [ ] **CTRL-03**: Layer toggles in filter panel (Services, Libraries, Infra, External)
- [ ] **CTRL-04**: "Mismatches only" toggle to show only edges with detected mismatches
- [ ] **CTRL-05**: "Hide isolated nodes" toggle to hide nodes with zero connections
- [ ] **CTRL-06**: Boundary dropdown filter (when boundaries defined)
- [ ] **CTRL-07**: Language dropdown filter

### Data Model

- [x] **DATA-01**: New `actors` table stores external system actors with name, kind, direction, source
- [x] **DATA-02**: New `actor_connections` table links actors to services with direction and protocol
- [x] **DATA-03**: New `node_metadata` table with (service_id, view, key, value, source) for extensible metadata
- [x] **DATA-04**: Migration populates actors from existing connections with `crossing = 'external'`

### Intelligence

- [ ] **INTEL-01**: ChromaDB embeddings include boundary context and actor relationships alongside graph data
- [ ] **INTEL-02**: MCP impact_query responses include type-aware context (e.g., "library used by 3 services in payments boundary")
- [ ] **INTEL-03**: MCP impact_search responses include actor relationships (e.g., "payments-api connects to external Stripe via REST")

### Edge Rendering

- [ ] **EDGE-01**: REST connections render as solid lines
- [ ] **EDGE-02**: gRPC connections render as dashed lines
- [ ] **EDGE-03**: Event/messaging connections render as dotted lines
- [ ] **EDGE-04**: SDK/import connections render as solid arrows
- [ ] **EDGE-05**: Mismatch edges highlighted in red

## Future Requirements

### Views & Analysis (deferred to app discussion)

- **VIEW-01**: STRIDE threat model view with trust boundaries
- **VIEW-02**: Vulnerability view with CVE annotations per node
- **VIEW-03**: Deployment view showing k8s namespaces and replicas
- **VIEW-04**: Data flow view with output types per service
- **VIEW-05**: Multi-view switcher UI

### Actors (deferred)

- **ACTOR-05**: Config-based actor declarations in allclear.config.json
- **ACTOR-06**: Human actor inference from auth middleware patterns
- **ACTOR-07**: Inbound actor detection from webhook route patterns

### Documentation

- **DOC-01**: Doc repo scanning and representation in graph

## Out of Scope

| Feature | Reason |
|---------|--------|
| STRIDE / threat modeling | Deferred to standalone app discussion |
| Vulnerability tracking | Requires external tool integration (trivy, npm audit) — future milestone |
| Deployment views | Requires k8s metadata not available from code scan |
| Human actor inference | Auth pattern detection is fragile and framework-specific |
| Config-based actor declarations | No payoff until UI visualization is proven |
| Standalone app / team features | Separate strategic decision — not a plugin feature |
| Auto-inferred boundaries | Hallucination risk — boundaries must be user-defined |
| Doc repo scanning | Fundamentally different from dependency scanning — needs own design |
| Dagre/ELK layout library | Start with custom grid; only adopt if edge routing demands it |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 33 | Complete |
| DATA-02 | Phase 33 | Complete |
| DATA-03 | Phase 33 | Complete |
| DATA-04 | Phase 33 | Complete |
| LAYOUT-01 | Phase 34 | Complete |
| LAYOUT-02 | Phase 34 | Complete |
| LAYOUT-03 | Phase 34 | Complete |
| LAYOUT-04 | Phase 34 | Complete |
| LAYOUT-05 | Phase 34 | Complete |
| NODE-01 | Phase 34 | Complete |
| NODE-02 | Phase 34 | Complete |
| NODE-03 | Phase 34 | Complete |
| NODE-05 | Phase 34 | Complete |
| ACTOR-01 | Phase 35 | Complete |
| ACTOR-02 | Phase 35 | Complete |
| ACTOR-03 | Phase 35 | Complete |
| ACTOR-04 | Phase 35 | Complete |
| NODE-04 | Phase 35 | Complete |
| EDGE-01 | Phase 36 | Pending |
| EDGE-02 | Phase 36 | Pending |
| EDGE-03 | Phase 36 | Pending |
| EDGE-04 | Phase 36 | Pending |
| EDGE-05 | Phase 36 | Pending |
| CTRL-01 | Phase 37 | Pending |
| CTRL-02 | Phase 37 | Pending |
| CTRL-03 | Phase 37 | Pending |
| CTRL-04 | Phase 37 | Pending |
| CTRL-05 | Phase 37 | Pending |
| CTRL-06 | Phase 37 | Pending |
| CTRL-07 | Phase 37 | Pending |
| INTEL-01 | Phase 38 | Pending |
| INTEL-02 | Phase 38 | Pending |
| INTEL-03 | Phase 38 | Pending |

**Coverage:**
- v3.0 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation*
