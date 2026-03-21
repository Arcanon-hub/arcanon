# Requirements: Ligamen

**Defined:** 2026-03-21
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v5.2.1 Requirements

Requirements for Scan Data Integrity patch. Each maps to roadmap phases.

### Scan Bracket Integrity

- [x] **SCAN-01**: POST /scan endpoint uses beginScan/endScan bracket for stale data cleanup (THE-930)
- [x] **SCAN-02**: Legacy NULL scan_version_id rows cleaned up after successful full scan (THE-931)

### Service Resolution

- [x] **SVCR-01**: Cross-repo service ID resolution scoped to avoid name collisions (THE-932)

### Scan Reliability

- [ ] **SREL-01**: Incremental scan prompt constrains agent to changed files (THE-933)
- [x] **SREL-02**: upsertService/upsertConnection sanitize undefined values to null before SQLite binding (THE-935)
- [x] **SREL-03**: CLI fallback scan passes explicit project root to openDb, not process.cwd() (THE-936)

### Confirmation UX

- [x] **CONF-01**: Confirmation flow accepts common synonyms (sure, yep, looks good → yes) and re-prompts on ambiguous input instead of silently ignoring (THE-934)

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Context Menu

- **CTX-01**: User can right-click a node to access actions (copy name, show blast, open repo)
- **CTX-02**: Context menu adapts options based on node type (service vs library vs infra)

### Advanced Visualization

- **VIZ-01**: Minimap overview showing full graph with viewport indicator
- **VIZ-02**: On-canvas legend showing node shape → type mapping
- **VIZ-03**: Zoom level indicator with reset-to-100% click
- **VIZ-04**: URL state persistence for bookmarkable views

### Release Tooling

- **REL-01**: Automated bump-version.sh script for all manifest files
- **REL-02**: make check version validation that all version files match

## Out of Scope

| Feature | Reason |
|---------|--------|
| Structured numbered-options confirmation UI | THE-934 suggests it but tolerant parsing is sufficient for v5.2.1 |
| Full rewrite of scan manager | These are targeted fixes, not an overhaul |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCAN-01 | Phase 63 | Complete |
| SCAN-02 | Phase 63 | Complete |
| SREL-02 | Phase 64 | Complete |
| SREL-03 | Phase 64 | Complete |
| SVCR-01 | Phase 65 | Complete |
| CONF-01 | Phase 66 | Complete |
| SREL-01 | Phase 66 | Pending |

**Coverage:**
- v5.2.1 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after roadmap creation — all 7 requirements mapped*
