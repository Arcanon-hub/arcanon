# Requirements: Ligamen

**Defined:** 2026-03-22
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.3.0 Requirements

Requirements for Scan Intelligence & Enrichment milestone. Each maps to roadmap phases.

### Quality Gate Spinout

- [ ] **QGATE-01**: Quality-gate command and skill extracted to standalone plugin (THE-937)

### Schema Surfacing

- [ ] **SCHEMA-01**: Schema/field data displayed in detail panel when connection selected (THE-938)
- [ ] **SCHEMA-02**: MCP impact tools include field-level severity in responses (THE-938)

### Confidence & Evidence

- [x] **CONF-01**: Confidence column persisted on services and connections via migration 009 (THE-939)
- [x] **CONF-02**: Evidence snippets persisted on connections (THE-939)
- [x] **CONF-03**: Confidence badge visible on nodes/edges in graph UI (THE-939)

### Team Ownership

- [x] **OWN-01**: CODEOWNERS parsed and team ownership stored in node_metadata (THE-940)
- [ ] **OWN-02**: Owner displayed in detail panel (THE-940)
- [ ] **OWN-03**: Owner included in MCP impact_query/impact_changed responses (THE-940)

### Enrichment Architecture

- [x] **ENRICH-01**: Enrichment pass framework runs after core scan, before graph display (THE-941)
- [x] **ENRICH-02**: Each pass writes to node_metadata with distinct view key (THE-941)
- [x] **ENRICH-03**: Pass failures logged and skipped — never abort the scan (THE-941)

### Agent Data Quality

- [ ] **AGENT-01**: Agent prompt makes source_file required on connections (THE-942)
- [ ] **AGENT-02**: Validation warns when source_file missing on connections (THE-942)
- [ ] **AGENT-03**: File paths displayed in detail panel connections list (THE-942)

### Auth & DB Extraction

- [x] **AUTHDB-01**: Auth mechanism extracted per service via enrichment pass (THE-943)
- [x] **AUTHDB-02**: Database backend extracted per service via enrichment pass (THE-943)
- [ ] **AUTHDB-03**: Auth and DB info included in MCP impact responses (THE-943)

### Unknown State Display

- [ ] **UNK-01**: Missing metadata fields show "unknown" in detail panel instead of being hidden (THE-944)

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Context Menu

- **CTX-01**: User can right-click a node to access actions (copy name, show blast, open repo)
- **CTX-02**: Context menu adapts options based on node type

### Advanced Visualization

- **VIZ-01**: Minimap overview showing full graph with viewport indicator
- **VIZ-02**: On-canvas legend showing node shape → type mapping
- **VIZ-03**: Zoom level indicator with reset-to-100% click
- **VIZ-04**: URL state persistence for bookmarkable views

### Release Tooling

- **REL-01**: Automated bump-version.sh script for all manifest files
- **REL-02**: make check version validation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Security audit dashboard | Auth data serves Claude's coding workflow, not compliance reporting |
| Team-based graph filtering | Filtering by owner is service catalog territory (Backstage, Cortex) |
| Structured numbered confirmation UI | Tolerant synonym parsing from v5.2.1 is sufficient |
| Schema diff viewer | Show data shape only; diff is future scope |
| Deployment status/cost/SLA | Platform tool features, not coding plugin |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 67 | Complete |
| CONF-02 | Phase 67 | Complete |
| ENRICH-01 | Phase 68 | Complete |
| ENRICH-02 | Phase 68 | Complete |
| ENRICH-03 | Phase 68 | Complete |
| OWN-01 | Phase 68 | Complete |
| AUTHDB-01 | Phase 69 | Complete |
| AUTHDB-02 | Phase 69 | Complete |
| CONF-03 | Phase 70 | Complete |
| SCHEMA-02 | Phase 71 | Pending |
| OWN-02 | Phase 71 | Pending |
| OWN-03 | Phase 71 | Pending |
| AUTHDB-03 | Phase 71 | Pending |
| SCHEMA-01 | Phase 72 | Pending |
| UNK-01 | Phase 72 | Pending |
| AGENT-01 | Phase 73 | Pending |
| AGENT-02 | Phase 73 | Pending |
| AGENT-03 | Phase 73 | Pending |
| QGATE-01 | Phase 73 | Pending |

**Coverage:**
- v5.3.0 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation — all 19 requirements mapped to phases 67-73*
